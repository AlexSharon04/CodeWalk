# CodeWalk — Phase 2c + Phase 3 Slice

**Branch.** `phase1-core-loop` (current; will likely cut new branch `phase2c-narrative-and-nav` once approved).
**Cache version bump.** `EXPLANATION_PROMPT_VERSION` v2 → v3 (existing sweep evicts v2 entries on activation).
**Working-tree caveat.** `codewalk/src/providers/commentController.ts` has uncommitted Concepts-render WIP. That render code disappears under this plan — the WIP can either be committed first as historical record (small `phase2b/render-fixup` commit) or stashed and dropped. Recommend stash + drop since the file is rewritten.

---

## Context

Phase 2b shipped a 6-field kind-aware schema (`purpose` + `flow` + `uses` + `produces` + `watch` + `concepts`). Manual verification surfaced three issues with how it lands:

1. **Pre-populating trivial blocks at segmentation time fights the user's mental model.** "Start CodeWalk" should label blocks; explanations are an on-click affair.
2. **Output is too dense.** ~15–25 bullet points per block reads as "study material," not a code-reading cheat sheet. User wants 3–5 sentences total.
3. **Prefetching all non-trivial blocks at segmentation is the wrong shape now that Phase 3 keyboard nav is landing.** Adjacent-only prefetch keyed on the user's actual click is more precise and scales to fast Alt+↓/Alt+↑ stepping.

There's also a stuck render bug: `<details>` Concepts blocks don't render their body in `vscode.CommentThread` comment bodies (different renderer than hovers). The single-narrative schema sidesteps this entirely — Concepts is gone.

This slice also opens Phase 3 in full: keyboard nav, status bar, sidebar file-picker, multi-file queue. Adjacent prefetch is wired to the keyboard nav so that walking the file with Alt+↓ keeps the next-N blocks warm.

---

## Scope

### In scope

1. **Schema redesign — single narrative.** Replace v2's 6-field schema with a single `summary` field (3–5 sentences). Drop `kind` from the public schema; `synthesizeTrivial` keeps using `segment.difficulty` internally.
2. **Drop eager trivial pre-population.** Remove the `trivialSub` listener in `extension.ts:85-98`. Keep click-time `synthesizeTrivial` short-circuit in `explain()` so trivial clicks remain instant.
3. **Adjacent-block prefetch.** New `enqueueNeighbors(uri, anchorId)` method on `PrefetchQueue` with 200ms throttle/merge. Fires from `commentController.expand()` after the click's own fetch is in flight. New setting `codewalk.explanation.prefetchNeighborsOnClick` default `true`. Existing `prefetchOnSegmentation` retained as opt-in (default `false`).
4. **Phase 3 — full nav.**
   - `codewalk.nextBlock` / `codewalk.prevBlock` / `codewalk.skipFile` commands.
   - Keybindings Alt+↓ / Alt+↑ / Alt+S, gated by `when: codewalk.active`.
   - Status bar item: `CodeWalk: File X/N | Block X/N` with click-to-jump on each segment.
   - Sidebar TreeView ("CodeWalk Files") with file checkboxes filtered by `files.exclude`.
   - Multi-file queue with per-file state cleanup on advance.
   - `WalkSession` service owns transient state.

### Out of scope

- Per-line annotations / hovers (Phase 4).
- Cross-file symbol accumulator (Phase 5, `docs/POST_MVP_VISION.md`).
- Markdown export, walkthrough summary screen.
- Adapter changes — `OpenAICompatibleAdapter` untouched.

---

## Design

### 1. Schema (v3)

```ts
// codewalk/src/types/index.ts (or wherever Explanation lives)

export interface Explanation {
  segmentId: string;
  summary: string;                         // 3-5 sentences, plain markdown text
  renderState: "streaming" | "done" | "error";
}
```

`kind`, `purpose`, `flow`, `uses`, `produces`, `watch`, `concepts` and the `Concept` type are removed.

JSON schema (Anthropic `json_schema` strict path):

```json
{
  "name": "codewalk_explanation",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": { "summary": { "type": "string" } },
    "required": ["summary"],
    "additionalProperties": false
  }
}
```

### 2. Prompt — `codewalk/prompts/explanation.md`

System half rewritten end-to-end. Keep the `## Input` split. Target reader stays "entry-level programmer skimming an unfamiliar codebase."

Key prompt rules:
- Output is a single `summary` string, 3–5 sentences, max ~600 chars.
- First sentence: what the block does in programmer terms (no restating the literal code).
- If the block does I/O, name the specific endpoint, table, or file path inside the summary.
- If the block has a non-obvious risk, append a short `Watch …` clause naming the specific concern (line N reference welcome).
- No bullets, no markdown headers, no preamble, no closing remarks.
- Trivial blocks tagged by segmenter never reach the LLM (orchestrator short-circuits).

Retry-path system-half augmentation unchanged from Phase 2b — append `CRITICAL: …` with specific reason.

### 3. Validation (ADR-005 mapping)

| Rule | v3 implementation |
|---|---|
| 1. Input guard | `SegmentTooLargeError` unchanged. `synthesizeTrivial` short-circuit unchanged. |
| 2. Parse | `JSON.parse(raw)` → `RawExplanation`. On exception → `ValidationFailure("response is not valid JSON")`. |
| 3. Per-item validate | `summary` is non-empty string, ≥ 40 chars, ≤ 700 chars (hard cap), not equal (trimmed/lowercased) to `segment.oneLiner`, no leading triple-backtick fence, no leading "Here is" / "Sure" preamble (reuse generic-phrase regex). |
| 4. Cross-item validate | Single field — no cross-item rules. (Schema simplification trades validation surface for prompt-discipline cost.) |
| 5. Retry | Single retry with threaded reason — unchanged machinery. |
| 6. Diagnostics | Logger line: `[explanation] segmentId=... source=llm summaryChars=N modelTimeMs=M retryFired=bool`. Synth path: `source=synth summaryChars=N`. |
| 7. Eval | Fixture's `mustMention` scans `summary` directly. `expectedKind` removed from fixture shape. |
| Cancellation | Unchanged. |
| Content-hash ids | Unchanged. |

### 4. Streaming

`extractPartialPurpose` → `extractPartialSummary` (regex `"summary"\s*:\s*"((?:[^"\\]|\\.)*)`). Same behavior; renamed field. The animated loader (`renderLoaderFrame` in `commentController.ts:87-105`) keeps working unchanged — it already pulls `partialPurpose = exp?.purpose` which becomes `partialSummary = exp?.summary`.

### 5. Trivial fast path — kept but no eager write

`synthesizeTrivial(segment) → { segmentId, summary: segment.oneLiner, renderState: "done" }`.

Called only from inside `explain()` when `segment.difficulty === "trivial"`. The eager-write listener in `extension.ts:85-98` is removed entirely. First click on a trivial block hits the synth path → instant render → cache write. Same UX feel, but cache fills lazily.

### 6. Render

`renderExplanation(exp)` collapses to:

```ts
function renderExplanation(exp: Explanation): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = false;
  md.isTrusted = false;
  md.appendMarkdown(exp.summary);
  return md;
}
```

All 6-field rendering code (lines ~272–305 in current file) is deleted. `escapeHtml` helper is deleted (no HTML left). Streaming intermediate renderer (loader frame) keeps the dot animation + elapsed counter.

### 7. PrefetchQueue refactor

```ts
// codewalk/src/engine/prefetchQueue.ts
export class PrefetchQueue {
  // existing
  enqueueAll(uri: vscode.Uri, segments: readonly Segment[]): void { /* unchanged */ }

  // NEW
  enqueueNeighbors(uri: vscode.Uri, anchorId: string, segments: readonly Segment[]): void {
    const idx = segments.findIndex(s => s.id === anchorId);
    if (idx < 0) return;
    const targets = [segments[idx - 1], segments[idx + 1]].filter((s): s is Segment => !!s);
    this.enqueueWithThrottle(uri, targets);
  }

  // NEW — internal
  private throttle = new Map<string, { lastFiredMs: number; pending: Set<string> }>();
  private enqueueWithThrottle(uri: vscode.Uri, segs: Segment[]): void { /* 200ms window; merge */ }
}
```

Throttle behavior: per `uri.toString()`, if last call was < 200 ms ago, merge `segs` into the pending set instead of dispatching new workers; the existing job-runner loop drains the pending set.

`commentController.expand(segmentId)` ends with (after the click's own `explain()` is in flight):

```ts
if (this.deps.prefetchNeighborsOnClick && this.deps.prefetchQueue) {
  const segs = this.segStore.get(uri);
  if (segs) this.deps.prefetchQueue.enqueueNeighbors(uri, segmentId, segs);
}
```

### 8. Phase 3 — full nav

**Commands** (register in `extension.ts`, declare in `package.json`):
- `codewalk.nextBlock` — advance to segment[i+1] in current file; if at end, advance file queue.
- `codewalk.prevBlock` — segment[i-1]; if at start, retreat file queue.
- `codewalk.skipFile` — drop current file from queue; advance to next.
- `codewalk.openFromTree` (internal) — fired by sidebar checkbox toggle.

**Context key.** `codewalk.active` set true when `WalkSession` has any file queued; cleared on session end. Used by keybindings:
```json
[
  { "command": "codewalk.nextBlock", "key": "alt+down", "when": "codewalk.active && editorTextFocus" },
  { "command": "codewalk.prevBlock", "key": "alt+up",   "when": "codewalk.active && editorTextFocus" },
  { "command": "codewalk.skipFile",  "key": "alt+s",     "when": "codewalk.active" }
]
```
Note `editorTextFocus` scoping for Alt+↓/Alt+↑ avoids the "Move Line Up/Down" collision (those default to Alt+↓/Alt+↑ already; CodeWalk's `when` clause needs to win when active — verify in dev host).

**Status bar.** Single `vscode.StatusBarItem` (`alignment: Left, priority: 100`). Text format `$(book) CodeWalk: File 2/4 | Block 5/12`. Clicking either segment opens a QuickPick to jump.

**Sidebar TreeView.** `codewalk.fileQueue` view registered in a custom view container `codewalk` (icon: book). Two top-level groups: "Available files" (workspace, filtered by `files.exclude`) and "Selected" (the current queue). Each item has a checkbox (`vscode.TreeItemCheckboxState`). Toggle adds/removes from the queue.

**WalkSession service.** New class in `codewalk/src/services/walkSession.ts`. Owns:
- Ordered `fileQueue: vscode.Uri[]` and `activeIndex`.
- Per-file `Segment[]` cache (indirected via `SegmentStore`).
- `currentBlockIndex` for the active file.
- `onDidAdvance` event emitter so status bar / tree view re-render.
- Disposes per-file decorations + threads when advancing or ending.

`codewalk.startWalkthrough` becomes "open the sidebar, prompt user to pick files, then begin." Behavior on a single active editor is preserved (auto-queue just that file) for backwards compatibility with Phase 1/2 demo flow.

### 9. Cache invalidation

- Bump `EXPLANATION_PROMPT_VERSION` `"v2"` → `"v3"` in `explanationAgent.ts`.
- `ExplanationStore` construction sweep already evicts entries whose `promptVersion !== EXPLANATION_PROMPT_VERSION`. Existing v2 entries die on first activation. No migration code.
- Manual escape hatch: `codewalk.resetExplanationCache` command unchanged.

### 10. New / modified settings (`package.json`)

```json
{
  "codewalk.explanation.prefetchNeighborsOnClick": {
    "type": "boolean",
    "default": true,
    "description": "Prefetch the segments directly above and below a clicked block so neighbor clicks (and Alt+↑/↓ nav) feel instant."
  }
}
```

`codewalk.explanation.prefetchOnSegmentation` retained, default stays `false`.

---

## Files to modify

**Edits.**
- `codewalk/src/types/index.ts` — drop `Concept`, slim `Explanation` to `{segmentId, summary, renderState}`.
- `codewalk/src/engine/explanationAgent.ts` — version bump, schema constant, validator rewrite, `extractPartialPurpose` → `extractPartialSummary`, `synthesizeTrivial` returns `{summary: oneLiner}`. ~50% of the file shrinks.
- `codewalk/src/engine/explanationStore.ts` — touch tests only (eviction logic already general).
- `codewalk/src/engine/prefetchQueue.ts` — add `enqueueNeighbors` + throttle map.
- `codewalk/src/providers/commentController.ts` — collapse renderer to one-line append; wire `enqueueNeighbors` at end of `expand()`. Remove `escapeHtml`. Remove all v2-field rendering.
- `codewalk/src/extension.ts` — drop `trivialSub` (lines 85-98 + ref at 45/69/145); register new commands; instantiate `WalkSession`, status bar, file-queue tree.
- `codewalk/prompts/explanation.md` — rewrite system half + simplify input section (drop `{{difficulty}}` stays; drop concepts/produces guidance).
- `codewalk/package.json` — add commands, keybindings, view container, view contribution, new setting.
- `codewalk/test/eval/explanationEval.test.ts` — fixture shape simplified (`mustMention` scans `summary`; `expectedKind` removed).

**New files.**
- `codewalk/src/services/walkSession.ts` — multi-file queue + active-block state owner.
- `codewalk/src/services/statusBar.ts` — `StatusBarItem` manager subscribed to `WalkSession.onDidAdvance`.
- `codewalk/src/views/fileQueueProvider.ts` — `TreeDataProvider` for the sidebar.
- `codewalk/test/services/walkSession.test.ts` — queue advance / skip / end tests.
- `codewalk/test/views/fileQueueProvider.test.ts` — checkbox toggle wiring.

**Reused utilities.**
- Existing `findSegment` / `findUri` helpers in `commentController.ts:228-235` — usable for nav commands too; consider promoting to `segmentStore.ts` if Phase 3 nav needs them outside the controller.
- Existing `SegmentStore.onDidChange(uri)` → status bar subscribes as a fourth listener.
- Existing loader-animation machinery (`renderLoaderFrame`) survives unchanged with a renamed field.
- Existing `PrefetchQueue` per-URI cancellation (lines 35-39) — neighbor enqueue inherits this for free.

---

## Verification

**Unit tests (must pass):**
- `explanationAgent.test.ts` — rewrite suite for v3: short summary rejected, oneLiner-equal summary rejected, double-validation-failure → `MalformedResponseError`, retry threads reason, synth path returns `{summary: oneLiner}` without adapter call, streaming `extractPartialSummary` happy path + invalid-partial-JSON path, cancellation.
- `explanationStore.test.ts` — explicit v2→v3 eviction case.
- `prefetchQueue.test.ts` — `enqueueNeighbors` enqueues both neighbors when present, only one at file start/end, throttle merges within 200 ms window, AuthError disable persists across neighbor calls.
- `commentController.test.ts` — single-paragraph render asserts `md.value === exp.summary` and no other content.
- `walkSession.test.ts` — advance past last block in file advances file queue; skipFile drops file; end-of-queue clears `codewalk.active`.

**Eval harness.** `EVAL_EXPLANATION=1 npm test` runs against the migrated fixture; trend line should show summaries 3–5 sentences and `mustMention` PASS.

**Manual checklist (append to `docs/PROJECT_STATE.md`).**
1. Open `codewalk/test/fixtures/sample.ts`, run `CodeWalk: Start Walkthrough`. Sidebar opens; `sample.ts` is auto-checked. Status bar shows `File 1/1 | Block —`.
2. Click any CodeLens. Loader animates ("Analyzing… 0.4s"). Within ~3 s panel shows a single italic 3–5-sentence paragraph. No bullets, no Concepts dropdown, no `Flow`/`Uses`/`Produces`/`Watch` headers.
3. Click a trivial block (top-of-file imports). Panel opens instantly with just the segmenter's one-liner. No spinner.
4. Click block 5. Verify Output channel shows `[prefetch]` lines for blocks 4 and 6 within ~200 ms.
5. Press Alt+↓. Cursor jumps to block 6's range; its panel opens; status bar updates `Block 6/N`. Panel for block 6 lands instantly (prefetched).
6. Press Alt+↓ rapidly 5 times. Output channel should show throttled prefetch (no five separate batches; merged enqueues).
7. Open a second file via the sidebar checkbox. Press Alt+↓ from the last block of `sample.ts` — file queue advances to the new file; old file's threads/decorations are gone.
8. Press Alt+S mid-file. Current file disposed; queue advances.
9. Run `CodeWalk: Reset Explanation Cache`. Click a previously-seen block — re-streams.
10. Reload window with v2 entries in `globalState`. On activation, Output channel logs eviction count > 0; subsequent clicks re-stream.
11. Verify `Move Line Up/Down` still works (Alt+↑/↓ in plain editor without active walkthrough).

**Smoke test on both backends.** Run the demo once on Anthropic and once on Groq (per ADR-003 dogfood warning).

---

## Risks

1. **Single narrative loses cross-block consistency.** v2's bullet structure made adjacent block panels feel comparable. Plain prose might read more variable. Mitigation: prompt enforces "first sentence = what it does," giving consistent shape without enforcing schema. Revisit after a week of dogfooding.
2. **Phase 5 `uses`-text-to-link seam is dropped.** `POST_MVP_VISION.md:106-110` documented `uses` becoming clickable in Phase 5. With single narrative, Phase 5 must re-introduce structure (a separate `references: string[]` field) or use prompt-driven inline linking. Add a note to `POST_MVP_VISION.md` so the seam is tracked, not silently lost.
3. **Alt+↓/↑ collision with "Move Line Up/Down."** VS Code's built-in is unconditional in editor focus. The `when: codewalk.active && editorTextFocus` clause should win when set, but verify in extension dev host on both Win11 and macOS keymaps.
4. **Throttle window tuning.** 200 ms picked unscientifically. If Alt+↓ stepping feels janky, drop to 100 ms; if it over-fires, raise to 350 ms.
5. **Sidebar TreeView ergonomics.** A flat checkbox list of every workspace file gets ugly on big repos. Filter by `files.exclude` and ignore typical heavy dirs (`node_modules`, `dist`, `.git`). If still too many, defer the auto-population and require user to drag files in — but probably overkill for class scope.

---

## Commit cadence

Per `CLAUDE.md`: commit at phase boundaries and after each working vertical slice.

1. `phase2c/step1: schema v3 — single-narrative Explanation type + JSON schema`
2. `phase2c/step2: explanationAgent — v3 validator + extractPartialSummary + prompt rewrite`
3. `phase2c/step3: drop trivial pre-population from extension.ts`
4. `phase2c/step4: commentController — collapse renderer to single paragraph`
5. `phase2c/step5: PrefetchQueue.enqueueNeighbors + throttle`
6. `phase2c/step6: wire enqueueNeighbors into expand()`
7. `phase3/step1: WalkSession service + walk-session lifecycle in extension.ts`
8. `phase3/step2: nextBlock / prevBlock / skipFile commands + Alt+↓/↑/S keybindings`
9. `phase3/step3: status bar progress indicator`
10. `phase3/step4: sidebar TreeView file picker`
11. `phase3/step5: multi-file queue advancement + per-file dispose`
12. `phase3/step6: docs — PROJECT_STATE update + manual checklist + POST_MVP_VISION uses-seam note`

Each step is its own commit with explicit-paths `git add` (per memory `feedback_explicit_git_add.md`).
