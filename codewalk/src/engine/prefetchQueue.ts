import * as vscode from "vscode";
import type { Segment } from "../types";
import type { ExplanationDeps } from "./explanationAgent";
import { explain } from "./explanationAgent";
import type { ExplanationStore } from "./explanationStore";
import { AuthError } from "../llm/adapter";

export interface PrefetchQueueDeps {
  readonly explanationStore: ExplanationStore;
  readonly agentDeps: Pick<ExplanationDeps, "adapter" | "promptsDir" | "structuredOutputMode">;
  readonly preset: string;
  readonly promptVersion: string;
  readonly logger?: (msg: string) => void;
  readonly concurrency?: number;
}

interface Job {
  segment: Segment;
  uri: vscode.Uri;
}

interface ThrottleState {
  lastFiredMs: number;
  pending: Set<string>;
  timer?: NodeJS.Timeout;
}

const THROTTLE_WINDOW_MS = 200;

export class PrefetchQueue implements vscode.Disposable {
  private readonly concurrency: number;
  private readonly perUriTokens = new Map<string, vscode.CancellationTokenSource>();
  private readonly throttleState = new Map<string, ThrottleState>();
  private disabled = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PrefetchQueueDeps) {
    this.concurrency = deps.concurrency ?? 2;
  }

  enqueueAll(uri: vscode.Uri, segments: readonly Segment[]): void {
    if (this.disabled) return;
    // Cancel any in-flight work for this URI and replace.
    const existing = this.perUriTokens.get(uri.toString());
    if (existing) {
      existing.cancel();
      existing.dispose();
    }
    const source = new vscode.CancellationTokenSource();
    this.perUriTokens.set(uri.toString(), source);

    const needsFetch = segments.filter(seg => {
      if (seg.difficulty === "trivial") return false;
      const cached = this.deps.explanationStore.get(seg.id, this.deps.preset, this.deps.promptVersion);
      return !cached || cached.renderState !== "done";
    });

    const jobs: Job[] = needsFetch.map(segment => ({ segment, uri }));
    this.drainPromise = this.drainPromise.then(() => this.runBatch(jobs, source.token));
  }

  /**
   * Prefetch the segments directly above and below `anchorId`.
   * Calls within THROTTLE_WINDOW_MS for the same URI merge into a single batch
   * so rapid block-stepping (Alt+↑/↓) doesn't spawn five cancelled batches.
   */
  enqueueNeighbors(uri: vscode.Uri, anchorId: string, segments: readonly Segment[]): void {
    if (this.disabled) return;
    const idx = segments.findIndex(s => s.id === anchorId);
    if (idx < 0) return;
    const targets: Segment[] = [];
    if (idx > 0) targets.push(segments[idx - 1]!);
    if (idx < segments.length - 1) targets.push(segments[idx + 1]!);
    if (targets.length === 0) return;

    const key = uri.toString();
    const state = this.throttleState.get(key) ?? { lastFiredMs: 0, pending: new Set<string>() };
    for (const t of targets) state.pending.add(t.id);
    this.throttleState.set(key, state);

    const now = Date.now();
    if (now - state.lastFiredMs < THROTTLE_WINDOW_MS) {
      // Inside throttle window — defer the flush so additional calls can merge.
      if (!state.timer) {
        const remaining = THROTTLE_WINDOW_MS - (now - state.lastFiredMs);
        state.timer = setTimeout(() => this.flushNeighbors(uri, segments), remaining);
      }
      return;
    }

    // Outside window — fire immediately.
    this.flushNeighbors(uri, segments);
  }

  private flushNeighbors(uri: vscode.Uri, segments: readonly Segment[]): void {
    const key = uri.toString();
    const state = this.throttleState.get(key);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const pendingIds = state.pending;
    state.pending = new Set<string>();
    state.lastFiredMs = Date.now();
    if (pendingIds.size === 0) return;
    const segs = segments.filter(s => pendingIds.has(s.id));
    if (segs.length > 0) this.enqueueAll(uri, segs);
  }

  cancelAll(): void {
    for (const src of this.perUriTokens.values()) {
      src.cancel();
      src.dispose();
    }
    this.perUriTokens.clear();
    for (const state of this.throttleState.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.throttleState.clear();
  }

  /** Test hook — resolves when the latest enqueued batch has fully settled. */
  drain(): Promise<void> {
    return this.drainPromise;
  }

  dispose(): void {
    this.cancelAll();
  }

  private async runBatch(jobs: Job[], token: vscode.CancellationToken): Promise<void> {
    const workers: Promise<void>[] = [];
    let cursor = 0;
    const next = async (): Promise<void> => {
      while (cursor < jobs.length && !this.disabled && !token.isCancellationRequested) {
        const i = cursor++;
        const job = jobs[i]!;
        try {
          // Mark streaming placeholder so concurrent user clicks know an agent is working.
          this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, {
            segmentId: job.segment.id,
            summary: "",
            renderState: "streaming",
          });
          const exp = await explain(job.segment, "", {
            adapter: this.deps.agentDeps.adapter,
            promptsDir: this.deps.agentDeps.promptsDir,
            structuredOutputMode: this.deps.agentDeps.structuredOutputMode,
            logger: this.deps.logger,
            token,
          });
          this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, exp);
        } catch (err) {
          if (err instanceof AuthError) {
            this.disabled = true;
            this.deps.logger?.(`[prefetch] disabled: auth failed — fix API key and reload`);
            return;
          }
          this.deps.logger?.(`[prefetch] error segmentId=${job.segment.id} reason=${(err as Error).message}`);
        }
      }
    };
    for (let i = 0; i < Math.min(this.concurrency, jobs.length); i++) workers.push(next());
    await Promise.all(workers);
  }
}
