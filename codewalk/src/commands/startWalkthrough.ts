import * as vscode from "vscode";
import { readUserConfig } from "../utils/config";
import { resolveBackend } from "../llm/presets";
import { OpenAICompatibleAdapter } from "../llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../llm/ollamaDetection";
import { segment } from "../engine/segmenter";
import type { SegmentStore } from "../engine/segmentStore";
import {
  AuthError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../llm/adapter";

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

    const userConfig = readUserConfig();
    let resolved;
    try {
      resolved = resolveBackend(userConfig);
    } catch (e) {
      showSettingsError(`CodeWalk config error: ${(e as Error).message}`);
      return;
    }

    if (resolved.backend === "ollama-local") {
      const ok = await isOllamaReachable(resolved.baseUrl);
      if (!ok) {
        showSettingsInfo("CodeWalk needs an LLM backend. Choose one to continue.");
        return;
      }
    } else if (resolved.requiresApiKey && !resolved.apiKey) {
      showSettingsInfo("CodeWalk needs an API key for the selected backend.");
      return;
    }

    store.clear(document.uri);

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "CodeWalk: Analyzing…",
      },
      async () => {
        try {
          const promptsDir = context.asAbsolutePath("prompts");
          const segments = await segment(document, { adapter, promptsDir });
          store.set(document.uri, segments);
          output.appendLine(`[success] ${segments.length} segments for ${document.fileName}`);
        } catch (e) {
          handleError(e, output);
        }
      },
    );
  });
}

function showSettingsInfo(message: string): void {
  vscode.window
    .showInformationMessage(message, "Open Settings")
    .then((action) => {
      if (action === "Open Settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "codewalk");
      }
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
  } else {
    const err = e as Error;
    output.appendLine(`[Unhandled] ${err.stack ?? err.message ?? String(e)}`);
    vscode.window.showErrorMessage(
      "CodeWalk encountered an unexpected error. See the Output panel.",
    );
  }
}
