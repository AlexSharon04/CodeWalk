import * as vscode from "vscode";
import { SegmentStore } from "./engine/segmentStore";
import { CodeWalkLensProvider } from "./providers/codeLensProvider";
import { BlockHighlighter } from "./editor/highlights";
import { registerStartWalkthrough } from "./commands/startWalkthrough";
import { registerBlockNavCommands } from "./commands/blockNav";
import { migrateLegacyApiKey, setApiKey } from "./utils/secrets";
import { ExplanationStore } from "./engine/explanationStore";
import { EXPLANATION_PROMPT_VERSION } from "./engine/explanationAgent";
import { CodeWalkCommentController } from "./providers/commentController";
import { PrefetchQueue } from "./engine/prefetchQueue";
import { WalkSession } from "./services/walkSession";
import { CodeWalkStatusBar } from "./services/statusBar";
import { SegmentationStatusTracker } from "./services/segmentationStatusTracker";
import { FileQueueProvider } from "./views/fileQueueProvider";
import { readUserConfig } from "./utils/config";
import { resolveBackend } from "./llm/presets";
import { OpenAICompatibleAdapter } from "./llm/openAiCompatibleAdapter";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeWalk");
  const store = new SegmentStore();

  // Fire-and-forget: move any plaintext API key out of settings.json into SecretStorage.
  void migrateLegacyApiKey(context).catch((e) =>
    output.appendLine(`[secrets] migration failed: ${(e as Error).message}`),
  );

  const lensProvider = new CodeWalkLensProvider(store);
  const highlighter = new BlockHighlighter(store);
  const walkSession = new WalkSession(store);
  const statusBar = new CodeWalkStatusBar(walkSession, store);
  const segmentationStatusTracker = new SegmentationStatusTracker();
  const fileQueueProvider = new FileQueueProvider(walkSession, store, segmentationStatusTracker);
  const fileQueueView = vscode.window.createTreeView("codewalk.fileQueue", {
    treeDataProvider: fileQueueProvider,
    canSelectMany: false,
    showCollapseAll: false,
  });
  fileQueueView.onDidChangeCheckboxState((e) => {
    for (const [item, state] of e.items) {
      fileQueueProvider.toggleCheckbox(item.uri, state);
    }
  });
  const fileQueueRefreshCommand = vscode.commands.registerCommand(
    "codewalk.refreshFileQueue",
    () => fileQueueProvider.refreshWorkspaceFiles(),
  );

  const lensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: "file" },
    lensProvider,
  );

  const startCommand = registerStartWalkthrough(
    context,
    store,
    output,
    walkSession,
    segmentationStatusTracker,
  );
  const navCommands = registerBlockNavCommands(
    context,
    walkSession,
    store,
    output,
    segmentationStatusTracker,
  );

  // Logger for modules that need structured output.
  const logger = (msg: string) => output.appendLine(msg);

  // Explanation store — persists explanations across sessions.
  const explanationStore = new ExplanationStore(context, logger, EXPLANATION_PROMPT_VERSION);
  context.subscriptions.push(explanationStore);

  // Closure-scoped state for dynamic wiring.
  let commentController: CodeWalkCommentController | undefined;
  let prefetchQueue: PrefetchQueue | undefined;
  let segmentStoreSub: vscode.Disposable | undefined;

  // Async function to build the adapter and wire the controller + prefetch queue.
  async function rebuildWiring(): Promise<void> {
    const userConfig = await readUserConfig(context);
    let resolved;
    try {
      resolved = resolveBackend(userConfig);
    } catch (e) {
      output.appendLine(`[wiring] deferred: ${(e as Error).message}`);
      return;
    }

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      structuredOutputMode: resolved.structuredOutputMode,
    });

    // Dispose old instances before building new ones.
    commentController?.dispose();
    prefetchQueue?.dispose();
    segmentStoreSub?.dispose();

    // Build the prefetch queue unconditionally — adjacent prefetch on click is now
    // the default. The opt-in `prefetchOnSegmentation` setting decides whether the
    // queue is also fed from segmentation events.
    prefetchQueue = new PrefetchQueue({
      explanationStore,
      agentDeps: {
        adapter,
        promptsDir: context.asAbsolutePath("prompts"),
        structuredOutputMode: resolved.structuredOutputMode,
      },
      preset: resolved.backend,
      promptVersion: EXPLANATION_PROMPT_VERSION,
      logger,
    });

    const prefetchNeighborsOnClick = vscode.workspace
      .getConfiguration("codewalk.explanation")
      .get<boolean>("prefetchNeighborsOnClick", true);

    // Build the comment controller.
    commentController = new CodeWalkCommentController(
      store,
      explanationStore,
      {
        adapter,
        promptsDir: context.asAbsolutePath("prompts"),
        preset: resolved.backend,
        promptVersion: EXPLANATION_PROMPT_VERSION,
        logger,
        structuredOutputMode: resolved.structuredOutputMode,
        prefetchQueue,
        prefetchNeighborsOnClick,
        walkSession,
      },
    );

    // Opt-in: also prefetch every non-trivial block at segmentation time.
    const prefetchOnSegmentation = vscode.workspace
      .getConfiguration("codewalk.explanation")
      .get<boolean>("prefetchOnSegmentation", false);
    if (prefetchOnSegmentation) {
      segmentStoreSub = store.onDidChange((uri) => {
        const segs = store.get(uri);
        if (segs) prefetchQueue?.enqueueAll(uri, segs);
      });
    }
  }

  // Fire-and-forget: build wiring at activation.
  void rebuildWiring();

  // Re-wire on config changes.
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("codewalk.backend")
      || e.affectsConfiguration("codewalk.model")
      || e.affectsConfiguration("codewalk.baseUrl")
      || e.affectsConfiguration("codewalk.explanation.prefetchOnSegmentation")
      || e.affectsConfiguration("codewalk.explanation.prefetchNeighborsOnClick")
    ) {
      void rebuildWiring();
    }
  });
  context.subscriptions.push(configChangeListener);

  // Meta-disposable to clean up wiring on deactivation or config reload.
  context.subscriptions.push({
    dispose: () => {
      commentController?.dispose();
      prefetchQueue?.dispose();
      segmentStoreSub?.dispose();
    },
  });

  const expandBlockCommand = vscode.commands.registerCommand(
    "codewalk.expandBlock",
    async (segmentId?: string) => {
      if (!segmentId) return;
      if (!commentController) {
        vscode.window.showInformationMessage(
          "CodeWalk is still initializing — try again in a moment.",
        );
        return;
      }
      await commentController.expand(segmentId);
    },
  );

  const resetApiKeyCommand = vscode.commands.registerCommand(
    "codewalk.resetApiKey",
    async () => {
      await setApiKey(context, "");
      output.appendLine("[secrets] api key cleared; next Start CodeWalk will re-run the wizard");
      vscode.window.showInformationMessage(
        "CodeWalk API key cleared. Run Start CodeWalk to re-enter it.",
      );
    },
  );

  const resetExplanationCacheCommand = vscode.commands.registerCommand(
    "codewalk.resetExplanationCache",
    () => {
      explanationStore.clear();
      vscode.window.showInformationMessage("CodeWalk: explanation cache cleared.");
    },
  );

  const endWalkthroughCommand = vscode.commands.registerCommand(
    "codewalk.endWalkthrough",
    () => {
      commentController?.collapse();
      store.clearAll();
      walkSession.end();
      output.appendLine("[walkthrough] ended by user");
    },
  );

  const closeHandler = vscode.workspace.onDidCloseTextDocument((doc) => {
    store.clear(doc.uri);
  });

  // Follow the user's editor focus while a walkthrough is active. Only update
  // when the focused URI is already in the queue — clicking into an unrelated
  // file should not auto-add it (that's the sidebar's job).
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor || !walkSession.isActive()) return;
    const uri = editor.document.uri;
    const inQueue = walkSession.state().fileQueue.some((q) => q.toString() === uri.toString());
    if (!inQueue) return;
    walkSession.setActive(uri, undefined);
  });

  // One-time hint about the status bar location. Many minimal VS Code setups
  // hide the status bar by default — without this, the user gets zero progress
  // feedback during a walkthrough and never knows what they're missing.
  const STATUS_BAR_HINT_KEY = "codewalk.statusBarHintShown";
  let statusBarHintSub: vscode.Disposable | undefined;
  if (!context.globalState.get<boolean>(STATUS_BAR_HINT_KEY, false)) {
    statusBarHintSub = walkSession.onDidChange(() => {
      if (!walkSession.isActive()) return;
      void context.globalState.update(STATUS_BAR_HINT_KEY, true);
      statusBarHintSub?.dispose();
      statusBarHintSub = undefined;
      void vscode.window.showInformationMessage(
        "CodeWalk shows progress in the status bar. If it's hidden, enable it via View → Appearance → Status Bar.",
      );
    });
    context.subscriptions.push({
      dispose: () => statusBarHintSub?.dispose(),
    });
  }

  context.subscriptions.push(
    output,
    store,
    walkSession,
    statusBar,
    segmentationStatusTracker,
    fileQueueProvider,
    fileQueueView,
    fileQueueRefreshCommand,
    lensProvider,
    highlighter,
    lensRegistration,
    startCommand,
    expandBlockCommand,
    resetApiKeyCommand,
    resetExplanationCacheCommand,
    endWalkthroughCommand,
    closeHandler,
    activeEditorListener,
    ...navCommands,
  );

  output.appendLine("CodeWalk activated.");
}

export function deactivate(): void {
  // VS Code disposes everything in context.subscriptions automatically.
}
