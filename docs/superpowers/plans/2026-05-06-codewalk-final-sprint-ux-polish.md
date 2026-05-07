# CodeWalk — Final Sprint: UX Polish + Dispose Lifecycle

**Branch.** `phase2c-narrative-and-nav` (current; sprint commits land on the same branch since Phase 2c+3 hasn't merged yet).
**Position.** Closes the post-2026-05-06 UX backlog raised during Phase 2c+3 user testing, plus the cheap Phase 4 polish item (CodeLens difficulty colors). **Phase 4 line-by-line annotations remain parked** — they are the next sprint, not this one. See "Explicitly out of scope" below.

---

## Context

Phase 2c+3 shipped end-to-end on this branch: v3 single-narrative schema, adjacent prefetch, WalkSession service, Alt+↓/↑/S keybindings, status bar progress, sidebar TreeView, cross-file auto-segmentation. F5 user testing on 2026-05-06 surfaced six concrete UX gaps that prevent the demo from feeling polished:

1. No way to cleanly **end** a walkthrough — `codewalk.endWalkthrough` exists half-wired but isn't bound to a UI surface, so decorations linger and the status bar stays visible after the user is done.
2. The sidebar shows whether a file is **queued**, but not whether it's been **segmented yet**. The user can't tell at a glance which checked file is ready to walk vs. which still needs LLM analysis.
3. The status bar tracks the file you most recently clicked a CodeLens in — not the file you're actually focused on. Clicking a tab does nothing until you trigger a CodeLens.
4. CodeLens labels are uniform black text. Difficulty is encoded only in the background tint; the per-block urgency signal disappears the moment your eyes leave the colored band.
5. No way to **pre-segment all checked files in the background** while the user reads the first one. Right now the only path is per-file on-demand at Alt+↓-crosses-boundary.
6. If the user has the status bar disabled in workbench settings (default for many minimal setups), they get zero progress feedback — and we never tell them where to look.

This sprint also picks up the one Phase 4 deliverable that's cheap to ship now and would otherwise drift: **difficulty colors on CodeLens labels themselves** (Phase 4 deliverable #4 from `IMPLEMENTATION_PLAN.md`).

---

## Scope

### In scope

1. **End walkthrough command + dispose lifecycle.** `codewalk.endWalkthrough` palette command + sidebar title-bar action. On end: collapse open comment thread, clear segments from BlockHighlighter for active file (decorations vanish), hide status bar, call `walkSession.end()` (clears queue, flips `codewalk.active` context key off). Per-file dispose-on-advance stays as-is (breadcrumbs trump cleanup mid-walk per existing decision in PROJECT_STATE.md).
2. **Sidebar segmentation status indicator.** Each row in `FileQueueProvider` shows one of three states: ✓ (segmented — has entries in `SegmentStore`), spinner (currently being segmented), ○ (queued, not yet segmented). New tiny `SegmentationStatusTracker` service publishes a "currently segmenting" set; `FileQueueProvider` listens and re-renders.
3. **`onDidChangeActiveTextEditor` listener.** When the user clicks into an editor whose URI is in the queue, `walkSession.setActive(uri, undefined)` so status bar follows their focus. **Skip** when URI isn't in the queue (no auto-add — that's an explicit gesture via the sidebar). Skip when walkSession isn't active.
4. **Background pre-segmentation setting.** `codewalk.preSegmentQueuedFiles` (default `false`). When `true`, after Start CodeWalk lands the first file, fire-and-forget `segmentFileForWalk` for every other un-segmented queued file via a concurrency-1 worker. No user-facing progress notification — log to output channel and update sidebar status icon. Cancel in-flight calls when the workspace is closed or the walkthrough ends.
5. **Difficulty colors on CodeLens labels.** Use VS Code's built-in ThemeIcons via `$(circle-filled)` in the title string, mapped per difficulty. Verified on light + dark themes. Phase 4 deliverable #4 — landing now since the rest of Phase 4 is parked.
6. **Status bar visibility one-time hint.** First time `codewalk.active` becomes true, surface a one-time toast: `"CodeWalk shows progress in the status bar — enable via View → Appearance → Status Bar if it's hidden."` Gate via `globalState.get("codewalk.statusBarHintShown")`. Fires once per machine, ever.

### Explicitly out of scope (**Phase 4 line-by-line — next sprint**)

- "Show Line-by-Line" comment thread title-bar button.
- Per-line `after.contentText` decorations (one DecorationType reused).
- `HoverProvider` for per-line detail.
- `prompts/lineByLine.md` + new agent following the ADR-005 contract.
- Eval harness for line-by-line agent.

These five items are an entire sprint of their own — new prompt, new schema, new validator, new eval fixtures, new comment-thread title contribution, new hover provider. Bundling them with this UX-polish sprint risks shipping nothing well. Park them in `IMPLEMENTATION_PLAN.md` Phase 4 and queue as the next sprint after this one.

### Also out of scope

- Per-file dispose policy revisit (`PROJECT_STATE.md` calls this out as a UX call needed). Current behavior — keep decorations as breadcrumbs — stays. Revisit only if user reports the lingering tints as visual noise.
- Walkthrough state persistence across reloads (not raised this session; deferred).
- Markdown export of walkthrough.

---

## Design

### 1. End walkthrough + dispose lifecycle

**New command.** `codewalk.endWalkthrough` registered in `extension.ts`. Body:

```ts
const endWalkthroughCommand = vscode.commands.registerCommand(
  "codewalk.endWalkthrough",
  () => {
    commentController?.collapse();
    walkSession.end();        // clears queue, flips context key
    output.appendLine("[walkthrough] ended by user");
  },
);
```

`walkSession.end()` already exists and clears state. The sidebar will re-render automatically (it subscribes to `walkSession.onDidChange`). The status bar already hides on `!walkSession.isActive()`. The `BlockHighlighter` listens to `SegmentStore.onDidChange` — and crucially we want decorations to **disappear** on end. Since `walkSession.end()` doesn't touch `SegmentStore`, decorations would persist. Two options:

- **Option A (chosen).** Add a `SegmentStore.clearAll()` call inside `endWalkthrough` so all decorations + CodeLenses vanish. Cache survives in `ExplanationStore` so re-running keeps the explanations warm.
- Option B. Add a "walkthrough active" gate to `BlockHighlighter` so decorations only render when `walkSession.isActive()`. More surgical but more wiring.

Option A is simpler and matches user intent ("end means clear the visual state"). The explanation cache is independent and untouched.

**UI surfaces.**
- Palette: `CodeWalk: End Walkthrough`.
- Sidebar title-bar action: same command, `$(close)` icon, alongside the existing Start + Refresh.
- `package.json` `menus.view/title` entry with `when: view == codewalk.fileQueue && codewalk.active` so it only appears mid-walkthrough.

### 2. Sidebar segmentation status indicator

**New service.** `src/services/segmentationStatusTracker.ts`:

```ts
export class SegmentationStatusTracker implements vscode.Disposable {
  private readonly inFlight = new Set<string>();   // uri.toString()
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  begin(uri: vscode.Uri): void {
    this.inFlight.add(uri.toString());
    this._onDidChange.fire();
  }
  end(uri: vscode.Uri): void {
    this.inFlight.delete(uri.toString());
    this._onDidChange.fire();
  }
  isInFlight(uri: vscode.Uri): boolean {
    return this.inFlight.has(uri.toString());
  }
  dispose(): void { this._onDidChange.dispose(); }
}
```

**Wired by `segmentFileForWalk`.** Pass the tracker as an optional dep; bracket the `withProgress` body with `tracker.begin(uri)` / `tracker.end(uri)` in a `try/finally`.

**FileQueueProvider extensions.**
- Constructor takes `SegmentStore` + `SegmentationStatusTracker` in addition to `WalkSession`.
- Subscribes to both `segStore.onDidChange` and `tracker.onDidChange` for tree refresh.
- `FileQueueItem.toTreeItem()` sets `iconPath` based on three states:
  - `tracker.isInFlight(uri)` → `new ThemeIcon("loading~spin")`
  - `segStore.get(uri) && segStore.get(uri).length > 0` → `new ThemeIcon("check")`
  - else → `new ThemeIcon("circle-outline")`

VS Code's native checkbox stays for queue add/remove; the icon is a separate visual signal.

### 3. `onDidChangeActiveTextEditor` listener

In `extension.ts`, after `walkSession` is constructed:

```ts
const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
  if (!editor || !walkSession.isActive()) return;
  const uri = editor.document.uri;
  const inQueue = walkSession.state().fileQueue.some(q => q.toString() === uri.toString());
  if (!inQueue) return;
  walkSession.setActive(uri, undefined);
});
context.subscriptions.push(activeEditorListener);
```

`walkSession.setActive(uri, undefined)` already does the right thing — sets `activeFileIndex` to the queue position and resets `activeBlockIndex` to -1. The status bar will re-render to show the new file. No-op when the URI isn't queued (don't auto-add — that's the sidebar's job).

### 4. Background pre-segmentation

**New setting.**

```json
"codewalk.preSegmentQueuedFiles": {
  "type": "boolean",
  "default": false,
  "description": "After Start CodeWalk segments the first file, automatically segment every other checked file in the sidebar in the background. Costs extra LLM calls but makes Alt+↓ across files feel instant."
}
```

**Worker.** Don't introduce a new class — keep it inline in `startWalkthrough.ts` as a fire-and-forget post-step:

```ts
// after segmentFileForWalk for the first file succeeds
if (vscode.workspace.getConfiguration("codewalk").get<boolean>("preSegmentQueuedFiles", false)) {
  void preSegmentRest(context, walkSession, store, output, document.uri);
}

async function preSegmentRest(
  context: vscode.ExtensionContext,
  walkSession: WalkSession,
  store: SegmentStore,
  output: vscode.OutputChannel,
  alreadyDone: vscode.Uri,
): Promise<void> {
  const queue = walkSession.state().fileQueue;
  for (const uri of queue) {
    if (uri.toString() === alreadyDone.toString()) continue;
    if ((store.get(uri)?.length ?? 0) > 0) continue;
    output.appendLine(`[preSegment] starting ${path.basename(uri.fsPath)}`);
    // segmentFileForWalk uses withProgress(Notification, cancellable: true) which is the
    // wrong UX for a background task; pass a flag to suppress the notification or wrap.
    await segmentFileForWalk(context, store, output, uri);
    output.appendLine(`[preSegment] done ${path.basename(uri.fsPath)}`);
  }
}
```

**Subtlety — progress notification.** `segmentFileForWalk` currently always shows a `withProgress(Notification, cancellable: true)`. For background mode we don't want a per-file modal. Add an optional flag `silent: boolean` to `segmentFileForWalk` that switches the progress location to `Window` (status-bar spinner) instead of `Notification`. Default stays `false` so the existing call sites are unchanged.

**Cancellation.** Tie an `AbortController`-equivalent via the dispose subscription on the activation context — when extension deactivates or the user runs End Walkthrough, we want to stop the worker. Practical implementation: track a `currentPreSegmentToken: vscode.CancellationTokenSource | undefined` in extension scope; pass into `segmentFileForWalk` (already supports `token` via `SegmenterDeps`); cancel + recreate it on End.

### 5. Difficulty colors on CodeLens labels

Update `CodeWalkLensProvider.provideCodeLenses` to prepend a colored circle icon per difficulty:

```ts
const ICON_BY_DIFFICULTY: Record<Difficulty, string> = {
  trivial:  "$(circle-outline)",          // outline gray
  standard: "$(circle-filled)",           // default blue
  complex:  "$(warning)",                 // orange triangle
  critical: "$(error)",                   // red circle-x
};

const title = `${ICON_BY_DIFFICULTY[seg.difficulty]} ${seg.label} — ${seg.oneLiner}`;
```

`$(...)` ThemeIcon syntax is supported in `CodeLens.command.title` (verified in VS Code 1.85+). Theme-respecting by default — the icons inherit foreground colors from the active theme. No theme-switching code needed.

### 6. Status bar visibility one-time hint

In `extension.ts` `activate()`, after `walkSession` is built, attach a one-shot listener:

```ts
const HINT_KEY = "codewalk.statusBarHintShown";
if (!context.globalState.get<boolean>(HINT_KEY, false)) {
  const sub = walkSession.onDidChange(() => {
    if (!walkSession.isActive()) return;
    void context.globalState.update(HINT_KEY, true);
    sub.dispose();
    void vscode.window.showInformationMessage(
      "CodeWalk shows progress in the status bar. If it's hidden, enable via View → Appearance → Status Bar.",
    );
  });
  context.subscriptions.push(sub);
}
```

Self-disposes on first fire so it can't repeat in the same session. `globalState` flag guarantees it can't repeat across sessions.

---

## Sequencing

The steps are mostly independent, so they can land in any order. Recommended order matches risk + value:

| Step | Scope | Reason for ordering |
|---|---|---|
| 1 | End walkthrough + dispose | Foundation — other steps may want to test "what happens on End." |
| 2 | Difficulty colors on CodeLens | Tiny, isolated; ship early to free working memory. |
| 3 | Active-editor listener | Tiny, isolated; one-line listener. |
| 4 | Sidebar segmentation status icon | Introduces SegmentationStatusTracker — needs a small refactor of `segmentFileForWalk`. |
| 5 | Background pre-segmentation | Builds on step 4's tracker (sidebar shows progress for the background runs). |
| 6 | Status bar visibility hint | Tiny; ship last so it doesn't fire while you're testing other steps. |
| 7 | Tests + tsc + esbuild verification | Verify in batch at the end. |
| 8 | PROJECT_STATE update + commit | Per CLAUDE.md — phase boundary commit. |

---

## Risks

- **Sidebar icon refresh churn.** Status icon listens to two events (segStore + tracker). Make sure the TreeView re-render fires only once per logical change — if both fire in tight sequence we get a double-paint. Acceptable; not a correctness bug.
- **Pre-segmentation budget.** A user with 8 checked files and a paid backend will burn ~8× the LLM calls when `preSegmentQueuedFiles` flips on. Mitigation: setting is default `false`, description spells out the cost. No automatic concurrency > 1 — sequential to keep rate-limiting predictable.
- **`onDidChangeActiveTextEditor` storm.** When VS Code restores a workspace with multiple open tabs, this event fires once per tab during restoration. The `inQueue` guard short-circuits all but queued files; the work inside `setActive` is cheap (array find + emitter fire). Should be safe but worth eyeballing the output channel during reload.
- **End walkthrough race with in-flight segmentation.** If the user hits End while `segmentFileForWalk` is mid-LLM call, the cancellation token wired into the tracker's pre-segmentation path catches it. The interactive-Start path uses its own `withProgress` cancel button, so End doesn't need to interrupt that explicitly.
- **CodeLens icon visual cost.** ThemeIcons in CodeLens titles render fine on supported VS Code versions. If on an older host they fall back to literal `$(...)` text. Engine min is `^1.85.0` which long predates ThemeIcon-in-title support; safe.

---

## Verification

Manual checklist (added to `docs/PROJECT_STATE.md` § "Phase 2c+3 manual verification checklist" as a final-sprint subsection):

1. **End walkthrough.** Start CodeWalk, click a few CodeLenses, then run `CodeWalk: End Walkthrough` from the palette OR click the close button on the sidebar title bar. Verify: (a) open thread collapses, (b) decorations disappear, (c) status bar hides, (d) sidebar checkboxes all clear, (e) `codewalk.active` flips off (Alt+↓ no longer triggers nextBlock — falls through to Move Line Down).
2. **Sidebar status icon.** Check 3 files in the sidebar. Run Start CodeWalk. First file shows spinner during segmentation, then ✓. Other 2 files show ○. Toggle `codewalk.preSegmentQueuedFiles = true`, reload, repeat — second and third files cycle spinner → ✓ in the background.
3. **Active-editor listener.** Mid-walkthrough, switch to a different queued file's tab via Ctrl+Click in the explorer. Status bar updates to show the new file index. Status bar block index resets to "—" until you click a CodeLens.
4. **Difficulty colors on CodeLens.** Open `codewalk/test/fixtures/sample.ts`. Verify the four difficulties show distinct icons (○ for trivial, ● for standard, ⚠ for complex, ✕ for critical, themed). Switch to a light theme, verify icons remain visible.
5. **Status bar hint.** Fresh install (clear `globalState` via `Developer: Reload Window` after running `codewalk.statusBarHintShown` reset — or test on a clean profile). First Start CodeWalk fires the toast exactly once. Run Start CodeWalk again — no toast. Reload window — no toast.
6. **No regressions.** Phase 2c+3 manual checklist (lines 222-249 of PROJECT_STATE.md) still passes.

Build verification (the vscode-test runner is wedged on this Win11 host per `project_vscode_test_wedge.md` memory):

```
cd codewalk && npx tsc --noEmit && npm run build
```

Both must complete clean before commit. F5 Extension Development Host for the manual checklist above.

---

## Followups (next session, after this sprint merges)

- **Phase 4 line-by-line.** New spec + plan files. The agent needs ADR-005 contract: input guard (skip blocks > N lines), parse, per-line validate (non-empty, no preamble, ≤ 60 chars for `after.contentText`), cross-line validate (count matches input lines), single retry with threaded reason, env-gated eval harness. The render layer needs ONE shared `TextEditorDecorationType` reused across lines, plus a `HoverProvider` bound to per-line ranges.
- **Per-file dispose policy revisit.** UX call needed once user has lived with breadcrumbs for a few sessions.
- **Walkthrough state persistence across reloads.** Open question; may not matter if End Walkthrough is the natural exit gesture.
