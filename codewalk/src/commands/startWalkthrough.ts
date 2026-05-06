import * as vscode from "vscode";
import { readUserConfig } from "../utils/config";
import { resolveBackend } from "../llm/presets";
import { isOllamaReachable } from "../llm/ollamaDetection";
import type { SegmentStore } from "../engine/segmentStore";
import { runFirstRunWizard } from "./firstRunWizard";
import { segmentFileForWalk } from "./segmentFile";
import type { WalkSession } from "../services/walkSession";

export function registerStartWalkthrough(
  context: vscode.ExtensionContext,
  store: SegmentStore,
  output: vscode.OutputChannel,
  walkSession?: WalkSession,
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

    // Resolve backend / fire wizard if needed. segmentFileForWalk also resolves
    // backend, but it doesn't run the wizard — Start CodeWalk is the wizard's
    // entry point, so we handle it here.
    const userConfig = await readUserConfig(context);
    let resolved;
    try {
      resolved = resolveBackend(userConfig);
    } catch (e) {
      showSettingsError(`CodeWalk config error: ${(e as Error).message}`);
      return;
    }

    const ollamaNotReady =
      resolved.backend === "ollama-local" && !(await isOllamaReachable(resolved.baseUrl));
    const cloudKeyMissing =
      resolved.backend !== "ollama-local" && resolved.requiresApiKey && !resolved.apiKey;

    if (ollamaNotReady || cloudKeyMissing) {
      const wizardResult = await runFirstRunWizard(context);
      if (!wizardResult) return;
      if (
        wizardResult.backend === "ollama-local" &&
        !(await isOllamaReachable(wizardResult.baseUrl))
      ) {
        vscode.window.showErrorMessage(
          `CodeWalk can't reach Ollama at ${wizardResult.baseUrl}. Start Ollama and try again.`,
        );
        return;
      }
    }

    const result = await segmentFileForWalk(context, store, output, document.uri);
    if (result.ok) {
      walkSession?.addFile(document.uri);
      walkSession?.start();
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
