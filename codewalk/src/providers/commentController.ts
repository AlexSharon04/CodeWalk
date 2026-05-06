import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { ExplanationStore } from "../engine/explanationStore";
import type { Explanation, Segment } from "../types";
import type { ExplanationDeps } from "../engine/explanationAgent";
import { explain } from "../engine/explanationAgent";
import {
  CancelledError,
  MalformedResponseError,
  NetworkError,
} from "../llm/adapter";
import {
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../engine/explanationAgent";

export interface CommentControllerDeps {
  readonly adapter: ExplanationDeps["adapter"];
  readonly promptsDir: string;
  readonly preset: string;
  readonly promptVersion: string;
  readonly logger?: (msg: string) => void;
  readonly structuredOutputMode?: ExplanationDeps["structuredOutputMode"];
}

class CodeWalkComment implements vscode.Comment {
  constructor(
    public body: vscode.MarkdownString,
    public mode: vscode.CommentMode = vscode.CommentMode.Preview,
    public author: vscode.CommentAuthorInformation = { name: "CodeWalk" },
  ) {}
}

export class CodeWalkCommentController implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private openThread: vscode.CommentThread | undefined;
  private openSegment: Segment | undefined;
  private openTokenSource: vscode.CancellationTokenSource | undefined;
  private loaderTimer: ReturnType<typeof setInterval> | undefined;
  private loaderStartMs: number | undefined;
  private readonly storeSub: vscode.Disposable;

  constructor(
    private readonly segStore: SegmentStore,
    private readonly expStore: ExplanationStore,
    private readonly deps: CommentControllerDeps,
  ) {
    this.controller = vscode.comments.createCommentController("codewalk", "CodeWalk");
    this.storeSub = this.expStore.onDidChange(id => this.onExplanationChanged(id));
  }

  hasOpenThread(): boolean {
    return this.openThread !== undefined;
  }

  openSegmentId(): string | undefined {
    return this.openSegment?.id;
  }

  currentThreadBody(): string | undefined {
    if (!this.openThread) return undefined;
    const c = this.openThread.comments[0];
    if (!c) return undefined;
    const body = c.body;
    return typeof body === "string" ? body : body.value;
  }

  collapse(): void {
    this.stopLoader();
    if (this.openTokenSource) {
      this.openTokenSource.cancel();
      this.openTokenSource.dispose();
      this.openTokenSource = undefined;
    }
    this.openThread?.dispose();
    this.openThread = undefined;
    this.openSegment = undefined;
  }

  private startLoader(): void {
    if (this.loaderTimer) return;
    this.loaderStartMs = Date.now();
    this.renderLoaderFrame();
    this.loaderTimer = setInterval(() => this.renderLoaderFrame(), 250);
  }

  private renderLoaderFrame(): void {
    if (!this.openThread || !this.openSegment || this.loaderStartMs === undefined) return;
    const exp = this.expStore.get(this.openSegment.id, this.deps.preset, this.deps.promptVersion);
    const partialSummary = exp?.summary ?? "";
    const elapsedMs = Date.now() - this.loaderStartMs;
    const dotCount = 1 + Math.floor(elapsedMs / 400) % 3;
    const dots = ".".repeat(dotCount);
    const secs = (elapsedMs / 1000).toFixed(1);
    const md = new vscode.MarkdownString("", true);
    md.supportHtml = false;
    md.isTrusted = false;
    if (partialSummary.length === 0) {
      md.appendMarkdown(`_Analyzing${dots} (${secs}s)_`);
    } else {
      md.appendMarkdown(partialSummary);
      md.appendMarkdown(`\n\n---\n\n_Gathering details${dots} (${secs}s)_`);
    }
    this.openThread.comments = [new CodeWalkComment(md)];
  }

  private stopLoader(): void {
    if (this.loaderTimer) {
      clearInterval(this.loaderTimer);
      this.loaderTimer = undefined;
      this.loaderStartMs = undefined;
    }
  }

  async expand(segmentId: string): Promise<void> {
    // Toggle behavior: same id closes the open thread.
    if (this.openSegment?.id === segmentId) {
      this.collapse();
      return;
    }

    const segment = this.findSegment(segmentId);
    if (!segment) {
      this.deps.logger?.(`[commentController] WARN expand called for unknown segmentId=${segmentId}`);
      return;
    }

    this.collapse();  // close previous if any

    const uri = this.findUri(segmentId);
    if (!uri) return;
    const range = new vscode.Range(segment.startLine - 1, 0, segment.endLine - 1, 0);
    const thread = this.controller.createCommentThread(uri, range, []);
    thread.label = this.buildThreadLabel(uri, segment);
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply = false;
    thread.comments = [new CodeWalkComment(new vscode.MarkdownString("_Analyzing…_"))];
    this.openThread = thread;
    this.openSegment = segment;

    // Cache hit?
    const cached = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
    if (cached && cached.renderState === "done") {
      thread.comments = [new CodeWalkComment(renderExplanation(cached))];
      return;
    }
    if (cached && cached.renderState === "streaming") {
      // Another caller (e.g. prefetch) already opened this stream. Start the loader so
      // the user sees "Gathering details…" until the producer flips renderState to done.
      thread.comments = [new CodeWalkComment(renderExplanation(cached))];
      this.startLoader();
      return;
    }

    // Cache miss — fetch.
    this.openTokenSource = new vscode.CancellationTokenSource();
    const fileContext = ""; // Future work: full-file context. Phase 2 leaves this empty.
    this.startLoader();
    this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
      segmentId,
      summary: "",
      renderState: "streaming",
    });

    const token = this.openTokenSource.token;
    try {
      const final = await explain(segment, fileContext, {
        adapter: this.deps.adapter,
        promptsDir: this.deps.promptsDir,
        logger: this.deps.logger,
        token,
        structuredOutputMode: this.deps.structuredOutputMode,
        onPartial: partial => {
          const current = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
          if (!current) return;
          this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
            ...current,
            summary: partial.summary ?? current.summary,
            renderState: "streaming",
          });
        },
      });
      this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, final);
    } catch (err) {
      this.stopLoader();
      if (err instanceof CancelledError) {
        if (this.openThread === thread) {
          thread.comments = [new CodeWalkComment(new vscode.MarkdownString("_Cancelled._"))];
        }
        return;
      }
      // Replace the body with an error. Do NOT persist error state.
      const message = errorMessage(err);
      if (this.openThread === thread) {
        thread.comments = [new CodeWalkComment(new vscode.MarkdownString(message))];
      }
      this.deps.logger?.(`[commentController] WARN explain failed segmentId=${segmentId} err=${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  private onExplanationChanged(segmentId: string): void {
    if (!this.openThread || this.openSegment?.id !== segmentId) return;
    const exp = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
    if (!exp) return;
    if (exp.renderState === "done") {
      this.stopLoader();
      this.openThread.comments = [new CodeWalkComment(renderExplanation(exp))];
    } else if (this.loaderTimer) {
      // Partial arrived mid-stream — snap the loader to the latest summary immediately
      // so we don't wait up to 250ms for the next interval tick.
      this.renderLoaderFrame();
    }
  }

  private buildThreadLabel(uri: vscode.Uri, segment: Segment): string {
    const segs = this.segStore.get(uri) ?? [];
    const idx = segs.findIndex(s => s.id === segment.id);
    const difficulty = segment.difficulty.charAt(0).toUpperCase() + segment.difficulty.slice(1);
    return idx >= 0 ? `Block ${idx + 1} · ${difficulty}` : difficulty;
  }

  private findSegment(segmentId: string): Segment | undefined {
    for (const uri of this.segStore.knownUris()) {
      const segs = this.segStore.get(uri) ?? [];
      const hit = segs.find(s => s.id === segmentId);
      if (hit) return hit;
    }
    return undefined;
  }

  private findUri(segmentId: string): vscode.Uri | undefined {
    for (const uri of this.segStore.knownUris()) {
      const segs = this.segStore.get(uri) ?? [];
      if (segs.some(s => s.id === segmentId)) return uri;
    }
    return undefined;
  }

  dispose(): void {
    this.collapse();
    this.storeSub.dispose();
    this.controller.dispose();
  }
}

function renderExplanation(exp: Explanation): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = false;
  md.isTrusted = false;

  if (exp.renderState === "streaming" && !exp.summary) {
    md.appendMarkdown("_Analyzing…_");
    return md;
  }

  md.appendMarkdown(exp.summary);
  return md;
}

function errorMessage(err: unknown): string {
  if (err instanceof SegmentTooLargeError) return `_Couldn't explain: block too large (${err.lineCount} / ${err.maxLines} lines)._`;
  if (err instanceof ExplanationStreamError) return "_Couldn't finish the explanation — the connection dropped._";
  if (err instanceof MalformedResponseError) return "_Couldn't parse the response from the LLM._";
  if (err instanceof NetworkError) return "_Network error while explaining this block._";
  return `_Error: ${(err as Error).message ?? "unknown"}_`;
}
