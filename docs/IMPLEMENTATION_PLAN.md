# CodeWalk — Master Implementation Plan

Condensed roadmap derived from `CodeWalk-design-doc.md` §12.4. Each phase is an independent spec → plan → implement cycle with a demo-able deliverable.

Refinements from Phase 1 execution are captured as ADRs in `ARCHITECTURE_DECISIONS.md` (ADR-001 unified adapter, ADR-002 externalized prompts, ADR-003 Ollama-default, ADR-004 first-run wizard). Read those before starting a new phase — they change baseline assumptions.

---

## Phase 1 — Core Loop — ✅ complete (2026-04-17)

**Goal.** An extension that segments a file via LLM and renders CodeLens labels plus colored block backgrounds in the editor.

**Deliverables (landed).**
1. ✅ Scaffold extension (`yo code`, TypeScript, esbuild).
2. ✅ `LLMAdapter` interface + unified `OpenAICompatibleAdapter` (ADR-001).
3. ✅ Segmenter: full file → typed `Segment[]`, 2-retry recovery on malformed JSON.
4. ✅ `CodeWalkLensProvider` rendering one clickable label per segment; fires `codewalk.expandBlock` with `segment.id`.
5. ✅ `BlockHighlighter` with four `TextEditorDecorationType`s, color-coded by difficulty.
6. ✅ `codewalk.startWalkthrough` command wired to the active editor with typed error handling.
7. ✅ First-run QuickPick wizard for backend selection (ADR-004).
8. ✅ Gated integration test against a real Ollama instance.

**Demo target (met).** Open a file, run "Start CodeWalk", see `▶ Block Name — one-liner` labels above each logical block with tinted backgrounds. Clicking does nothing yet — that lands in Phase 2.

**Phase-1 scaffolding ready for Phase 2.**
- `codewalk.expandBlock` command registered as a no-op stub (`src/extension.ts`). Phase 2 replaces the body, callsites unchanged.
- `SegmentStore.onDidChange(uri)` event already broadcasts segmentation updates; `CommentController` subscribes as a third listener alongside the provider and highlighter.
- All disposables (output channel, store, provider, highlighter, commands) wired into `context.subscriptions` — lifecycle is phase-agnostic.

**Explicitly out of scope (deferred to later phases).** Comment threads, line-by-line annotations, file picker sidebar, file queue, navigation shortcuts, hover tooltips, difficulty color coding on CodeLens labels themselves (currently on backgrounds only).

---

## Phase 2 — Level 1 Explanations

**Goal.** Clicking a CodeLens expands a rich Markdown panel with the block's summary and Points to Consider.

**Deliverables.**
7. `CommentController` for inline expandable panels (one controller per editor or one global — decide in Phase 2 spec).
8. CodeLens click → expand/collapse a comment thread at the block's range. `codewalk.expandBlock` receives `segmentId` and resolves it via `SegmentStore`.
9. "Only one panel open at a time" logic — expanding a new block collapses any previously open one. Track `openThread: Thread | undefined` state on the controller.
10. Render Points to Consider (assumptions, dangers, side effects) inside the comment body. Authored by a second agent prompt at `prompts/explanation.md` (naming TBD in spec).

**UI/UX intent.**
- Expansion feels inline, like a git-blame review comment — not a popover, not a sidebar. The user's eyes stay on the code.
- Markdown renders natively in `Comment.body`; code fences get syntax highlighting for free.
- Collapsing a thread is a single click on the thread header or re-clicking the triggering CodeLens.

**Depends on.** Phase 1 (`SegmentStore`, CodeLens wiring, `expandBlock` stub).

**Risks to surface in the spec.**
- Latency: each expansion = one LLM call. Decide streaming vs. full-response, and whether to pre-fetch (and how many) adjacent blocks.
- Prompt caching: Anthropic/OpenAI support it, Ollama does not. The unified adapter from ADR-001 does not expose caching headers yet — decide whether to add an escape hatch or accept the latency hit.
- Backend-agnostic rendering: Groq/Llama output differs in markdown formatting quirks from Claude. Lock the explanation prompt with explicit "respond with markdown only, no preamble" guidance.

**Demo target.** Click a CodeLens, see an expandable explanation panel attached to that block. Click a different label, the first collapses.

---

## Phase 3 — Navigation & File Queue

**Goal.** Multi-file walkthroughs with sidebar selection and keyboard navigation.

**Deliverables.**
11. `TreeView` sidebar file picker with checkboxes. Source: workspace files filtered by a `files.exclude`-aware glob.
12. Status bar display: `CodeWalk: File X/N | Block X/N` with prev/next actions as clickable segments.
13. Keyboard shortcuts: `Alt+↓` next block, `Alt+↑` prev block, `Alt+S` skip file. Register as `keybindings` in `package.json` with `when: codewalk.active` context key.
14. File queue advancement with per-file state cleanup — the previous file's threads and decorations dispose when the next file opens.

**UI/UX intent.**
- Sidebar is a companion to the walkthrough, not a replacement for the file explorer. User picks 3 files, hits Start, and the extension drives file order.
- Keyboard nav is the primary motion — mouse is the escape hatch, not the default. `Alt+↑`/`Alt+↓` are ergonomic for one-hand operation.
- Status bar is a progress indicator, not a control. Clicking is a convenience, not the main path.

**Depends on.** Phase 2 (expansion works per-file; now we're stitching files together).

**Risks to surface in the spec.**
- Context-switching cost: when the user advances to a new file, do we keep prior files' segments cached or evict? Memory vs. responsiveness tradeoff.
- Keybinding conflicts: `Alt+↓`/`Alt+↑` collide with "Move Line Down/Up" in VS Code defaults. Decide whether to scope via `when` clause or reassign.
- File-queue persistence: if the user reloads the window mid-walkthrough, is state restored? The Phase 3 spec should answer "persist / no-persist" explicitly.

**Demo target.** Pick 3 files from the sidebar, click "Start Walkthrough", navigate block-by-block across all 3 files using keyboard.

---

## Phase 4 — Level 2 & Polish

**Goal.** On-demand line-by-line annotations and production polish.

**Deliverables.**
15. "Show Line-by-Line" button in the comment thread title bar (`CommentThread.contextValue` + menu contribution).
16. `after.contentText` decorations for per-line inline annotations (one `DecorationType` reused across lines — see design-doc §12.5).
17. `HoverProvider` for rich per-line detail, bound to the same per-line annotation ranges.
18. Difficulty color coding on CodeLens labels themselves (gray/blue/orange/red via `$(icon)` prefix or themed title strings).
19. Full cleanup/dispose lifecycle for threads and decorations on walkthrough end or extension deactivate. A walkthrough-session object owns all transient state.

**UI/UX intent.**
- Line-by-line is opt-in, not default — it's visually dense, so it should only appear when the user signals "I want more depth."
- Hover is the natural progression from inline annotation: glance for the gist, hover for the full story.
- "End walkthrough" should leave the editor pristine — no lingering decorations, no orphan threads, no stale output-channel noise.

**Depends on.** Phase 3 (session-scoped state to dispose cleanly).

**Risks to surface in the spec.**
- `after.contentText` width: long annotations wrap awkwardly. Decide truncation policy + hover-for-full-text pattern.
- Decoration-type leak: creating a `TextEditorDecorationType` per line (instead of per difficulty) is the #1 memory-leak mistake in VS Code extensions. Explicitly tested for in Phase 4.
- Icon theming: CodeLens label colors need to respect light/dark themes — test on both.

**Demo target.** Expand a block, click "Show Line-by-Line", see inline annotations next to each line with hover-to-read-more. End the walkthrough — every decoration disappears cleanly.

---

## Cross-cutting (applies to all phases)

### Backend strategy

**Two supported paths, one codepath.** Per ADR-001, a single `OpenAICompatibleAdapter` speaks to every provider. Per ADR-003, `ollama-local` is the shipped default. Per ADR-004, a first-run QuickPick wizard handles backend selection and API-key entry so users never hand-edit `settings.json`.

| Path | Best for | Config |
| --- | --- | --- |
| **Ollama (local)** | Private or unsharable code, offline work, zero-cost, no account required. Default. | Auto-detected; no key needed. |
| **Cloud API key** | Low-end hardware, public code, speed over privacy. | Wizard stores key at `ConfigurationTarget.Global` (never workspace-committed). |

Phases 2+ must continue to support both paths. New prompts get tested against at least one local model (e.g. Qwen 2.5 Coder 7B) and one cloud model (e.g. Groq Llama 3.3 70B or Claude Sonnet) before shipping.

**Developer dogfood warning (from ADR-003).** The maintainer uses a cloud preset for daily iteration because integrated-GPU Ollama is too slow. Ollama-specific UX regressions can slip past dev testing. Every phase boundary includes a manual "run on Ollama" checkpoint.

### Prompts

Prompts live as standalone markdown files under `codewalk/prompts/` with `{{placeholder}}` substitution (ADR-002). Supersedes the `src/utils/prompts.ts` location from design-doc §11. Version them — track prompt edits explicitly in commit messages because behavior changes ride on them. Future phases add `explanation.md`, `lineByLine.md`, etc.

### Error handling

Every LLM call wraps in try/catch and surfaces failures to the user via `vscode.window.showErrorMessage`. Never silently fail. Typed errors (`NetworkError`, `AuthError`, `RateLimitError`, `MalformedResponseError`) live in `src/llm/adapter.ts` and map to distinct user-facing messages plus Output-channel log lines. Phase-1 policy: 2 retries on malformed JSON with a stricter retry prompt, then a typed error.

### Decoration lifecycle

Create each `TextEditorDecorationType` once and reuse across ranges (see `BlockHighlighter` for the reference implementation). Never create a new decoration type per line — that leaks memory (design-doc §12.5). Phase 4's `after.contentText` must follow the same rule.

### CodeLens refresh

Use an `EventEmitter<void>` on the provider (`onDidChangeCodeLenses`) to signal VS Code after async segmentation completes. `SegmentStore.onDidChange(uri)` is the canonical trigger. Phase 2's `CommentController` subscribes as a third listener alongside provider and highlighter — same pattern.

### Testing

- Unit tests for adapter JSON parsing, segment schema validation, and decoration range math.
- Integration tests that require a live LLM gate behind `CODEWALK_OLLAMA_TEST=1` so CI runs don't require network. Phase 1 ships one such test against Ollama.
- Future phases add integration tests for explanation rendering (Phase 2) and keyboard navigation (Phase 3).

### Packaging

Local `.vsix` via `vsce package` only for class deliverable. No Marketplace publish. `prompts/` is included in the bundle (not in `.vscodeignore`).
