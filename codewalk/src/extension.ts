import * as vscode from "vscode";
import { SegmentStore } from "./engine/segmentStore";
import { CodeWalkLensProvider } from "./providers/codeLensProvider";
import { BlockHighlighter } from "./editor/highlights";
import { registerStartWalkthrough } from "./commands/startWalkthrough";
import { migrateLegacyApiKey, setApiKey } from "./utils/secrets";
import { ExplanationStore } from "./engine/explanationStore";
import { EXPLANATION_PROMPT_VERSION, synthesizeTrivial } from "./engine/explanationAgent";
import { CodeWalkCommentController } from "./providers/commentController";
import { PrefetchQueue } from "./engine/prefetchQueue";
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

  const lensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: "file" },
    lensProvider,
  );

  const startCommand = registerStartWalkthrough(context, store, output);

  // Logger for modules that need structured output.
  const logger = (msg: string) => output.appendLine(msg);

  // Explanation store — persists explanations across sessions.
  const explanationStore = new ExplanationStore(context, logger, EXPLANATION_PROMPT_VERSION);
  context.subscriptions.push(explanationStore);

  // Closure-scoped state for dynamic wiring.
  let commentController: CodeWalkCommentController | undefined;
  let prefetchQueue: PrefetchQueue | undefined;
  let segmentStoreSub: vscode.Disposable | undefined;
  let trivialSub: vscode.Disposable | undefined;

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
    trivialSub?.dispose();

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
      },
    );

    // Eagerly pre-populate trivial explanations as segments are segmented.
    trivialSub = store.onDidChange((uri) => {
      const segs = store.get(uri);
      if (!segs) return;
      for (const seg of segs) {
        if (seg.difficulty === "trivial") {
          const cached = explanationStore.get(seg.id, resolved.backend, EXPLANATION_PROMPT_VERSION);
          if (!cached) {
            const trivialExp = synthesizeTrivial(seg);
            explanationStore.set(seg.id, resolved.backend, EXPLANATION_PROMPT_VERSION, trivialExp);
          }
        }
      }
    });

    // Conditionally wire the prefetch queue.
    const prefetchEnabled = vscode.workspace
      .getConfiguration("codewalk.explanation")
      .get<boolean>("prefetchOnSegmentation", false);
    if (prefetchEnabled) {
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
      trivialSub?.dispose();
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
    resetApiKeyCommand,
    resetExplanationCacheCommand,
    closeHandler,
  );

  output.appendLine("CodeWalk activated.");
}

export function deactivate(): void {
  // VS Code disposes everything in context.subscriptions automatically.
}
