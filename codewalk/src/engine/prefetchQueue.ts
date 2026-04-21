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

export class PrefetchQueue implements vscode.Disposable {
  private readonly concurrency: number;
  private readonly perUriTokens = new Map<string, vscode.CancellationTokenSource>();
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

  cancelAll(): void {
    for (const src of this.perUriTokens.values()) {
      src.cancel();
      src.dispose();
    }
    this.perUriTokens.clear();
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
            kind: "logic",
            purpose: "",
            flow: [],
            uses: [],
            produces: [],
            watch: [],
            concepts: [],
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
