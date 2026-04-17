# CodeWalk — Master Implementation Plan

Condensed roadmap derived from `CodeWalk-design-doc.md` §12.4. Each phase is an independent spec → plan → implement cycle with a demo-able deliverable.

---

## Phase 1 — Core Loop

**Goal.** An extension that segments a file via LLM and renders CodeLens labels plus colored block backgrounds in the editor.

**Deliverables.**
1. Scaffold extension (`yo code`, TypeScript, esbuild).
2. LLM adapter interface + single backend implementation.
3. Segmenter: full file → JSON `Segment[]`.
4. `CodeLensProvider` rendering one clickable label per segment.
5. `TextEditorDecorationType` applying block background tints, color-coded by difficulty.
6. `codewalk.startWalkthrough` command wired to the active editor.

**Demo target.** Open a file, run "Start CodeWalk", see `▶ Block Name — one-liner` labels above each logical block with tinted backgrounds. Clicking does nothing yet — that lands in Phase 2.

**Explicitly out of scope.** Comment threads, line-by-line annotations, file picker sidebar, file queue, navigation shortcuts, hover tooltips, multi-backend support, first-run wizard.

---

## Phase 2 — Level 1 Explanations

**Goal.** Clicking a CodeLens expands a rich Markdown panel with the block's summary and Points to Consider.

**Deliverables.**
7. `CommentController` for inline expandable panels.
8. CodeLens click → expand/collapse a comment thread at the block's range.
9. "Only one panel open at a time" logic — expanding a new block collapses any previously open one.
10. Render Points to Consider (assumptions, dangers, side effects) inside the comment body.

**Demo target.** Click a CodeLens, see an expandable explanation panel attached to that block. Click a different label, the first collapses.

**Depends on.** Phase 1.

---

## Phase 3 — Navigation & File Queue

**Goal.** Multi-file walkthroughs with sidebar selection and keyboard navigation.

**Deliverables.**
11. TreeView sidebar file picker with checkboxes.
12. Status bar display: `CodeWalk: File X/N | Block X/N` with prev/next actions.
13. Keyboard shortcuts: `Alt+↓` next block, `Alt+↑` prev block, `Alt+S` skip file.
14. File queue advancement with per-file state cleanup.

**Demo target.** Pick 3 files from the sidebar, click "Start Walkthrough", navigate block-by-block across all 3 files using keyboard.

**Depends on.** Phase 2.

---

## Phase 4 — Level 2 & Polish

**Goal.** On-demand line-by-line annotations and production polish.

**Deliverables.**
15. "Show Line-by-Line" button in the comment thread title bar.
16. `after.contentText` decorations for per-line inline annotations.
17. `HoverProvider` for rich per-line detail.
18. Difficulty color coding on CodeLens labels (gray/blue/orange/red).
19. Full cleanup/dispose lifecycle for threads and decorations on walkthrough end or extension deactivate.

**Demo target.** Expand a block, click "Show Line-by-Line", see inline annotations next to each line with hover-to-read-more. End the walkthrough — every decoration disappears cleanly.

**Depends on.** Phase 3.

---

## Cross-cutting (applies to all phases)

- **Prompts.** Live in `src/utils/prompts.ts` per design-doc §11. Version them — track prompt edits explicitly in commit messages because behavior changes ride on them.
- **Error handling.** Every LLM call wraps in try/catch and surfaces failures to the user via `vscode.window.showErrorMessage`. Never silently fail.
- **Decoration lifecycle.** Create each `TextEditorDecorationType` once and reuse across ranges. Never create a new decoration type per line — that leaks memory (see design-doc §12.5).
- **CodeLens refresh.** Use an `EventEmitter<void>` to signal `onDidChangeCodeLenses` after async segmentation completes.
- **Testing.** Unit tests for adapter JSON parsing, segment schema validation, and decoration range math. Integration tests that require a live LLM gate behind an env var so CI runs don't require network.
- **Packaging.** Local `.vsix` via `vsce package` only for class deliverable. No Marketplace publish.
