import * as vscode from "vscode";
import { readUserConfig } from "../utils/config";
import { resolveBackend } from "../llm/presets";
import { OpenAICompatibleAdapter } from "../llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../llm/ollamaDetection";
import { FileTooLargeError, segment } from "../engine/segmenter";
import type { SegmentStore } from "../engine/segmentStore";
import {
  AuthError,
  CancelledError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../llm/adapter";
import {
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../engine/explanationAgent";

export interface SegmentFileResult {
  ok: boolean;
  segmentCount: number;
}

/**
 * Segments a single file for the walk. No first-run wizard; assumes the user has
 * already configured a backend (or fails cleanly if not).
 *
 * Returns ok=true with a positive segmentCount on success, ok=false with reason
 * surfaced via the output channel + a user-facing message on failure.
 */
export async function segmentFileForWalk(
  context: vscode.ExtensionContext,
  store: SegmentStore,
  output: vscode.OutputChannel,
  uri: vscode.Uri,
): Promise<SegmentFileResult> {
  const userConfig = await readUserConfig(context);
  let resolved;
  try {
    resolved = resolveBackend(userConfig);
  } catch (e) {
    output.appendLine(`[wiring] config error: ${(e as Error).message}`);
    vscode.window.showErrorMessage(
      "CodeWalk isn't configured yet. Run Start CodeWalk to set up a backend.",
    );
    return { ok: false, segmentCount: 0 };
  }

  if (resolved.backend === "ollama-local" && !(await isOllamaReachable(resolved.baseUrl))) {
    vscode.window.showErrorMessage(
      `CodeWalk can't reach Ollama at ${resolved.baseUrl}. Start Ollama and try again.`,
    );
    return { ok: false, segmentCount: 0 };
  }
  if (resolved.backend !== "ollama-local" && resolved.requiresApiKey && !resolved.apiKey) {
    vscode.window.showErrorMessage(
      "CodeWalk needs an API key. Run Start CodeWalk to enter it.",
    );
    return { ok: false, segmentCount: 0 };
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    output.appendLine(`[segmentFile] open failed: ${(e as Error).message}`);
    return { ok: false, segmentCount: 0 };
  }

  if (document.getText().trim().length === 0) {
    output.appendLine(`[segmentFile] skipping empty file ${document.fileName}`);
    return { ok: false, segmentCount: 0 };
  }

  store.clear(document.uri);

  const adapter = new OpenAICompatibleAdapter({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    structuredOutputMode: resolved.structuredOutputMode,
  });

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CodeWalk: Analyzing ${document.fileName}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const promptsDir = context.asAbsolutePath("prompts");
        const segments = await segment(document, {
          adapter,
          promptsDir,
          logger: (msg) => output.appendLine(msg),
          token,
        });
        store.set(document.uri, segments);
        output.appendLine(`[success] ${segments.length} segments for ${document.fileName}`);
        return { ok: true, segmentCount: segments.length };
      } catch (e) {
        handleSegmentError(e, output);
        return { ok: false, segmentCount: 0 };
      }
    },
  );
}

function handleSegmentError(e: unknown, output: vscode.OutputChannel): void {
  if (e instanceof CancelledError) {
    output.appendLine("[cancelled] user cancelled CodeWalk analysis");
    return;
  }
  if (e instanceof SegmentTooLargeError) {
    output.appendLine(`[SegmentTooLargeError] ${e.message}`);
    vscode.window.showWarningMessage(
      `CodeWalk skipped a block too large to explain (${e.lineCount} / ${e.maxLines} lines).`,
    );
    return;
  }
  if (e instanceof ExplanationStreamError) {
    output.appendLine(`[ExplanationStreamError] ${e.message}`);
    vscode.window.showErrorMessage("CodeWalk couldn't finish the explanation. Try again.");
    return;
  }
  if (e instanceof NetworkError) {
    output.appendLine(`[NetworkError] ${e.message}`);
    vscode.window.showErrorMessage("CodeWalk couldn't reach the LLM. Check your connection.");
    return;
  }
  if (e instanceof AuthError) {
    output.appendLine(`[AuthError] ${e.message}`);
    vscode.window.showErrorMessage("CodeWalk's API key was rejected. Open settings to update it.");
    return;
  }
  if (e instanceof RateLimitError) {
    output.appendLine(`[RateLimitError] ${e.message}`);
    vscode.window.showErrorMessage("CodeWalk hit a rate limit. Try again in a moment.");
    return;
  }
  if (e instanceof MalformedResponseError) {
    output.appendLine(`[MalformedResponseError] ${e.message}`);
    vscode.window.showErrorMessage("CodeWalk couldn't parse the model's response.");
    return;
  }
  if (e instanceof FileTooLargeError) {
    output.appendLine(`[FileTooLargeError] ${e.message}`);
    vscode.window.showWarningMessage(
      `CodeWalk can't analyze files over ${e.maxLines} lines yet (${e.lineCount} lines).`,
    );
    return;
  }
  const err = e as Error;
  output.appendLine(`[Unhandled] ${err.stack ?? err.message ?? String(e)}`);
  vscode.window.showErrorMessage("CodeWalk encountered an unexpected error. See the Output panel.");
}
