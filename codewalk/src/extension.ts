import * as vscode from "vscode";
import { SegmentStore } from "./engine/segmentStore";
import { CodeWalkLensProvider } from "./providers/codeLensProvider";
import { BlockHighlighter } from "./editor/highlights";
import { registerStartWalkthrough } from "./commands/startWalkthrough";
import { migrateLegacyApiKey } from "./utils/secrets";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeWalk");
  const store = new SegmentStore();

  // Fire-and-forget: move any plaintext API key out of settings.json into SecretStorage.
  void migrateLegacyApiKey(context).catch((e) =>
    output.appendLine(`[secrets] migration failed: ${(e as Error).message}`),
  );

  const lensProvider = new CodeWalkLensProvider(store);
  const highlighter = new BlockHighlighter(store);

  const lensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: "file" },
    lensProvider,
  );

  const startCommand = registerStartWalkthrough(context, store, output);

  const expandBlockCommand = vscode.commands.registerCommand(
    "codewalk.expandBlock",
    (_segmentId?: string) => {
      // Phase 2 will implement panel expansion; Phase 1 keeps this no-op so the CodeLens command resolves.
    },
  );

  const closeHandler = vscode.workspace.onDidCloseTextDocument((doc) => {
    store.clear(doc.uri);
  });

  context.subscriptions.push(
    output,
    store,
    lensProvider,
    highlighter,
    lensRegistration,
    startCommand,
    expandBlockCommand,
    closeHandler,
  );

  output.appendLine("CodeWalk activated.");
}

export function deactivate(): void {
  // VS Code disposes everything in context.subscriptions automatically.
}
