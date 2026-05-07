import * as vscode from "vscode";
import * as path from "node:path";
import { readUserConfig } from "../utils/config";
import { resolveBackend } from "../llm/presets";
import { isOllamaReachable } from "../llm/ollamaDetection";
import type { SegmentStore } from "../engine/segmentStore";
import { runFirstRunWizard } from "./firstRunWizard";
import { segmentFileForWalk } from "./segmentFile";
import type { WalkSession } from "../services/walkSession";
import type { SegmentationStatusTracker } from "../services/segmentationStatusTracker";

export function registerStartWalkthrough(
  context: vscode.ExtensionContext,
  store: SegmentStore,
  output: vscode.OutputChannel,
  walkSession?: WalkSession,
  tracker?: SegmentationStatusTracker,
): vscode.Disposable {
  return vscode.commands.registerCommand("codewalk.startWalkthrough", async () => {
    // Decide what to segment next. Order of precedence:
    //   1. The first un-segmented file in the WalkSession queue (set by sidebar checkboxes).
    //   2. The active editor's file, if any — preserves the single-file demo flow when the
    //      sidebar hasn't been used.
    const targetUri = pickTargetUri(walkSession, store);

    if (!targetUri) {
      vscode.window.showInformationMessage(
        "CodeWalk: open a file or check files in the CodeWalk sidebar to start a walkthrough.",
      );
      return;
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(targetUri);
    } catch (e) {
      vscode.window.showErrorMessage(
        `CodeWalk couldn't open ${path.basename(targetUri.fsPath)}: ${(e as Error).message}`,
      );
      return;
    }
    if (document.getText().trim().length === 0) {
      vscode.window.showInformationMessage(
        `${path.basename(targetUri.fsPath)} is empty — nothing to walk through.`,
      );
      return;
    }

    // Resolve backend / fire wizard if needed. segmentFileForWalk also resolves
    // backend but doesn't run the wizard — Start CodeWalk is the wizard's
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

    // Surface the target file in the editor so the user sees where the walkthrough is
    // about to land — important when the target came from the sidebar queue rather
    // than the active editor.
    await vscode.window.showTextDocument(document, { preview: false });

    const result = await segmentFileForWalk(context, store, output, document.uri, { tracker });
    if (!result.ok) return;

    // setActive both auto-adds (if missing from queue) and switches activeFileIndex,
    // so the status bar / sidebar reflect the freshly-segmented file as the user's
    // current focus regardless of how this Start was triggered.
    walkSession?.setActive(document.uri, undefined);
    walkSession?.start();

    // Optional fire-and-forget background pre-segmentation of the rest of the queue.
    const preSegment = vscode.workspace
      .getConfiguration("codewalk")
      .get<boolean>("preSegmentQueuedFiles", false);
    if (preSegment && walkSession) {
      void preSegmentRest(context, walkSession, store, output, document.uri, tracker);
    }
  });
}

async function preSegmentRest(
  context: vscode.ExtensionContext,
  walkSession: WalkSession,
  store: SegmentStore,
  output: vscode.OutputChannel,
  alreadyDone: vscode.Uri,
  tracker: SegmentationStatusTracker | undefined,
): Promise<void> {
  const queue = walkSession.state().fileQueue;
  for (const uri of queue) {
    if (uri.toString() === alreadyDone.toString()) continue;
    if ((store.get(uri)?.length ?? 0) > 0) continue;
    if (!walkSession.isActive()) {
      output.appendLine(`[preSegment] aborted — walkthrough ended`);
      return;
    }
    output.appendLine(`[preSegment] starting ${path.basename(uri.fsPath)}`);
    await segmentFileForWalk(context, store, output, uri, { silent: true, tracker });
    output.appendLine(`[preSegment] done ${path.basename(uri.fsPath)}`);
  }
}

function pickTargetUri(
  walkSession: WalkSession | undefined,
  store: SegmentStore,
): vscode.Uri | undefined {
  const queue = walkSession?.state().fileQueue ?? [];
  for (const queuedUri of queue) {
    const segs = store.get(queuedUri);
    if (!segs || segs.length === 0) return queuedUri;
  }
  // Queue is empty or fully segmented — fall back to active editor for single-file flow
  // and for "I want to add this open file to the walk" gesture.
  return vscode.window.activeTextEditor?.document.uri;
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
