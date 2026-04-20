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
import { runFirstRunWizard } from "./firstRunWizard";

export function registerStartWalkthrough(
  context: vscode.ExtensionContext,
  store: SegmentStore,
  output: vscode.OutputChannel,
): vscode.Disposable {
  return vscode.commands.registerCommand("codewalk.startWalkthrough", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Open a file first to start CodeWalk.");
      return;
    }
    const document = editor.document;
    if (document.getText().trim().length === 0) {
      vscode.window.showInformationMessage("This file is empty — nothing to walk through.");
      return;
    }

    const userConfig = await readUserConfig(context);
    let resolved;
    try {
      resolved = resolveBackend(userConfig);
    } catch (e) {
      showSettingsError(`CodeWalk config error: ${(e as Error).message}`);
      return;
    }

    let finalResolved = resolved;
    const ollamaNotReady =
      resolved.backend === "ollama-local" && !(await isOllamaReachable(resolved.baseUrl));
    const cloudKeyMissing =
      resolved.backend !== "ollama-local" && resolved.requiresApiKey && !resolved.apiKey;

    if (ollamaNotReady || cloudKeyMissing) {
      const wizardResult = await runFirstRunWizard(context);
      if (!wizardResult) return; // user cancelled the wizard
      finalResolved = wizardResult;
      if (
        finalResolved.backend === "ollama-local" &&
        !(await isOllamaReachable(finalResolved.baseUrl))
      ) {
        vscode.window.showErrorMessage(
          `CodeWalk can't reach Ollama at ${finalResolved.baseUrl}. Start Ollama and try again.`,
        );
        return;
      }
    }

    store.clear(document.uri);

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: finalResolved.baseUrl,
      apiKey: finalResolved.apiKey,
      model: finalResolved.model,
      structuredOutputMode: finalResolved.structuredOutputMode,
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "CodeWalk: Analyzing…",
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
        } catch (e) {
          handleError(e, output);
        }
      },
    );
  });
}

function showSettingsError(message: string): void {
  vscode.window
    .showErrorMessage(message, "Open Settings")
    .then((action) => {
      if (action === "Open Settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "codewalk");
      }
    });
}

function handleError(e: unknown, output: vscode.OutputChannel): void {
  if (e instanceof CancelledError) {
    output.appendLine("[cancelled] user cancelled CodeWalk analysis");
    return;
  }
  if (e instanceof SegmentTooLargeError) {
    output.appendLine(
      `[SegmentTooLargeError] segmentId=${e.segmentId} lines=${e.lineCount}/${e.maxLines}`,
    );
    vscode.window.showWarningMessage(
      `CodeWalk skipped a block that's too large to explain (${e.lineCount} / ${e.maxLines} lines).`,
    );
    return;
  }
  if (e instanceof ExplanationStreamError) {
    output.appendLine(
      `[ExplanationStreamError] cause=${e.cause} message=${e.message}`,
    );
    vscode.window.showErrorMessage(
      "CodeWalk couldn't finish the explanation — the connection dropped. Try again.",
    );
    return;
  }
  if (e instanceof NetworkError) {
    output.appendLine(`[NetworkError] ${e.message}`);
    vscode.window.showErrorMessage(
      "CodeWalk couldn't reach the LLM. Check your connection and backend URL.",
    );
  } else if (e instanceof AuthError) {
    output.appendLine(`[AuthError] ${e.message}`);
    showSettingsError("CodeWalk's API key was rejected. Open settings to update it.");
  } else if (e instanceof RateLimitError) {
    output.appendLine(`[RateLimitError] ${e.message}${e.retryAfter ? ` retry-after: ${e.retryAfter}s` : ""}`);
    vscode.window.showErrorMessage("CodeWalk hit a rate limit. Try again in a moment.");
  } else if (e instanceof MalformedResponseError) {
    output.appendLine(`[MalformedResponseError] ${e.message}\nRaw: ${e.rawResponse ?? "<none>"}`);
    showSettingsError(
      "CodeWalk couldn't parse the model's response. Try a more capable model in settings.",
    );
  } else if (e instanceof FileTooLargeError) {
    output.appendLine(`[FileTooLargeError] ${e.message}`);
    vscode.window.showWarningMessage(
      `CodeWalk can't analyze files over ${e.maxLines} lines yet. This file has ${e.lineCount}.`,
    );
  } else {
    const err = e as Error;
    output.appendLine(`[Unhandled] ${err.stack ?? err.message ?? String(e)}`);
    vscode.window.showErrorMessage(
      "CodeWalk encountered an unexpected error. See the Output panel.",
    );
  }
}
