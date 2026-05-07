import * as vscode from "vscode";
import type { CodeWalkCommentController } from "../providers/commentController";
import type { LineByLineDecorator } from "../editor/lineByLineDecorator";
import type { LineByLineStore } from "../engine/lineByLineStore";
import type { LineByLineDeps } from "../engine/lineByLineAgent";
import { annotate, LINE_BY_LINE_PROMPT_VERSION, LineByLineTooLargeError } from "../engine/lineByLineAgent";
import {
  AuthError,
  CancelledError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../llm/adapter";

export interface ToggleLineByLineDeps {
  readonly commentController: () => CodeWalkCommentController | undefined;
  readonly decorator: LineByLineDecorator;
  readonly store: LineByLineStore;
  readonly preset: () => string | undefined;
  readonly agentDeps: () => LineByLineDeps | undefined;
  readonly logger: (msg: string) => void;
}

export function registerToggleLineByLine(deps: ToggleLineByLineDeps): vscode.Disposable {
  return vscode.commands.registerCommand(
    "codewalk.toggleLineByLine",
    async (_thread?: vscode.CommentThread) => {
      const cc = deps.commentController();
      const info = cc?.openSegmentInfo();
      if (!info) {
        vscode.window.showInformationMessage(
          "CodeWalk: open a block panel first, then toggle Line-by-Line from the panel header.",
        );
        return;
      }
      const preset = deps.preset();
      const agentDeps = deps.agentDeps();
      if (!preset || !agentDeps) {
        vscode.window.showErrorMessage(
          "CodeWalk isn't fully initialized yet. Try again in a moment.",
        );
        return;
      }

      const { segment, uri } = info;

      // Toggle off: decorations already visible for this URI.
      if (deps.decorator.hasUri(uri)) {
        deps.decorator.clear(uri);
        deps.logger(`[lineByLine] toggled off segmentId=${segment.id}`);
        return;
      }

      // Cache hit: apply instantly.
      const cached = deps.store.get(segment.id, preset, LINE_BY_LINE_PROMPT_VERSION);
      if (cached) {
        deps.decorator.apply(uri, cached.annotations);
        deps.logger(`[lineByLine] cache-hit segmentId=${segment.id} annotations=${cached.annotations.length}`);
        return;
      }

      // Cache miss: fetch with progress.
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CodeWalk: line-by-line annotations…",
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const result = await annotate(segment, { ...agentDeps, token });
            deps.store.set(segment.id, preset, LINE_BY_LINE_PROMPT_VERSION, result);
            deps.decorator.apply(uri, result.annotations);
            deps.logger(`[lineByLine] applied segmentId=${segment.id} annotations=${result.annotations.length}`);
          } catch (err) {
            handleError(err, deps.logger);
          }
        },
      );
    },
  );
}

function handleError(err: unknown, logger: (msg: string) => void): void {
  if (err instanceof CancelledError) {
    logger("[lineByLine] cancelled");
    return;
  }
  if (err instanceof LineByLineTooLargeError) {
    logger(`[LineByLineTooLargeError] ${err.message}`);
    vscode.window.showWarningMessage(
      `CodeWalk: this block (${err.lineCount} lines) is too long for line-by-line. Limit is ${err.maxLines}.`,
    );
    return;
  }
  if (err instanceof AuthError) {
    logger(`[AuthError] ${err.message}`);
    vscode.window.showErrorMessage("CodeWalk's API key was rejected. Open settings to update it.");
    return;
  }
  if (err instanceof RateLimitError) {
    logger(`[RateLimitError] ${err.message}`);
    vscode.window.showErrorMessage("CodeWalk hit a rate limit. Try again in a moment.");
    return;
  }
  if (err instanceof NetworkError) {
    logger(`[NetworkError] ${err.message}`);
    vscode.window.showErrorMessage("CodeWalk couldn't reach the LLM. Check your connection.");
    return;
  }
  if (err instanceof MalformedResponseError) {
    logger(`[MalformedResponseError] ${err.message}`);
    vscode.window.showErrorMessage("CodeWalk couldn't parse the line-by-line response.");
    return;
  }
  const e = err as Error;
  logger(`[lineByLine] WARN unhandled ${e.stack ?? e.message ?? String(err)}`);
  vscode.window.showErrorMessage("CodeWalk encountered an unexpected error. See the Output panel.");
}
