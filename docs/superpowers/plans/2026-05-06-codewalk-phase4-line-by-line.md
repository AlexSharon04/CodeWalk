# CodeWalk — Phase 4: Line-by-Line Annotations

**Branch.** `phase2c-narrative-and-nav` (current; Phase 4 commits land alongside the final-sprint UX commits).
**Depends on.** Phase 1 (segments, decorations) + Phase 2c (explanation panel) + Phase 3 (WalkSession, dispose hooks). Phase 5 (cross-file intelligence) explicitly out of scope.
**Cache.** New `LINE_BY_LINE_PROMPT_VERSION = "v1"`. Independent of `EXPLANATION_PROMPT_VERSION`. Separate `LineByLineStore` keyed `${preset}:${promptVersion}:${segmentId}`.

---

## Context

Phase 4 closes the original CodeWalk MVP design (per `docs/CodeWalk-design-doc.md` §4.2 and `docs/IMPLEMENTATION_PLAN.md` §Phase 4). The user, after reading a block-level summary in the comment thread, can press a "Show Line-by-Line" button to overlay per-line inline annotations next to each non-obvious line in that block. Hovering a line shows the full markdown explanation.

The summary stays as the default. Line-by-line is opt-in because:
- It's visually dense — every annotated line gets `after.contentText` greyed text. Showing this on every block by default would overwhelm.
- It costs one LLM call per block. The summary is the cheap default; line-by-line is a "I want to study this carefully" gesture.

Phase 4 also picks up the **dispose lifecycle** that the final-sprint End Walkthrough started — `endWalkthrough` now also clears line-by-line decorations.

The CodeLens difficulty colors that were originally Phase 4 deliverable #4 already shipped in the final-sprint commit. Phase 4 here is the remaining deliverables (#15-#19 in `IMPLEMENTATION_PLAN.md`).

---

## Scope

### In scope

1. **`prompts/lineByLine.md`.** New prompt file. Inputs the block code with line-numbered prefixes and the block's `oneLiner` for context; outputs an array of per-line annotations.
2. **`engine/lineByLineAgent.ts`.** ADR-005-compliant agent. `LINE_BY_LINE_PROMPT_VERSION = "v1"`. Schema: `{ annotations: [{ line: int, short: string ≤60 chars, full: string }] }`. Per-item validation (line in range, short non-empty + ≤60 chars + no preamble, full non-empty). Cross-item validation (no duplicate lines, sorted ascending). Single retry with threaded reason. `LineByLineTooLargeError` for blocks > 200 lines.
3. **`engine/lineByLineStore.ts`.** Mirrors `ExplanationStore`. Persist via `globalState`, key prefix `lineByLine:`, version-gated rehydrate sweep.
4. **`editor/lineByLineDecorator.ts`.** ONE `TextEditorDecorationType` reused across every annotation range (design-doc §12.5 — the per-line type is the #1 leak in VS Code extensions). Per-range styling carried via `DecorationOptions.renderOptions.after.contentText`. Tracks `Map<uriString, Map<line, fullText>>` so the hover provider can read it.
5. **`providers/lineByLineHoverProvider.ts`.** `vscode.HoverProvider` registered globally (filtered by URI presence in the decorator's map). Returns `MarkdownString` body. No command-URI links yet — that's Phase 5's seam.
6. **`codewalk.toggleLineByLine` command.** Title-bar action on the CodeWalk comment thread. On first invocation: fetches via `withProgress(Notification, cancellable: true)` + applies decorations. On subsequent invocations for the same segment: toggles visibility (decorations cleared, button label still says "Show" — re-fetch only if cache was invalidated).
7. **`thread.contextValue`** set to `"codewalk.lineByLine.off"` or `"codewalk.lineByLine.on"` so the menu can show different labels (Show vs Hide).
8. **End Walkthrough disposes line-by-line.** `decorator.clearAll()` called from `codewalk.endWalkthrough`.
9. **Eval harness** at `test/eval/lineByLineEval.test.ts` gated by `EVAL_LINEBYLINE=1`. One golden block. Loose thresholds — coverage ≥ 30% of block lines, every short ≤ 60 chars, no duplicate lines.
10. **Unit tests** for agent (validation paths), store (key + sweep), decorator (single-type reuse + clear).

### Explicitly out of scope

- Streaming line-by-line. The render shape (per-line) is hard to stream cleanly and the user's gesture ("show me more depth") tolerates a 3–5s wait on a progress notification.
- Command-URI links inside `full` markdown bodies. That's Phase 5 (jump-to-definition / cross-file references). Phase 4 returns plain markdown.
- Per-file dispose policy revisit. Decoration dispose-on-advance vs. breadcrumbs is a separate UX call; current behavior (breadcrumbs) stays.
- Walkthrough state persistence across reloads. Open question; not raised as critical.
- Phase 5 cross-file intelligence. Parked in `docs/POST_MVP_VISION.md`.

---

## Design

### 1. Types

```ts
// src/types/index.ts (additions)

export interface LineAnnotation {
  /** Absolute file line number, 1-indexed. */
  line: number;
  /** Inline rendering — plain text, ≤ 60 chars. */
  short: string;
  /** Hover body — markdown. */
  full: string;
}

export interface LineByLine {
  segmentId: string;
  annotations: LineAnnotation[];
  renderState: "done" | "error";
}
```

### 2. Prompt — `prompts/lineByLine.md`

System role: "annotate each non-obvious line in this block." Specifies:
- Use absolute file line numbers (not 1-indexed within the block).
- `short`: ≤ 60 chars plain text, no markdown, no preamble. Inline-render-friendly.
- `full`: markdown body, 1–3 sentences, may contain inline code, no fenced blocks.
- Skip self-evident lines (open braces, `return foo;` where `foo` was just assigned, blank declarations). Aim for 30–60% line coverage.
- Lines sorted ascending. No duplicates.

Schema:
```json
{
  "annotations": [
    { "line": int, "short": string, "full": string }
  ]
}
```

Block code is presented with each line prefixed by its absolute file line number, e.g.:

```
12: const x = readFromCache();
13: if (!x) throw new Error("missing");
14: return decode(x);
```

so the model can return absolute numbers without doing math in its head.

### 3. Agent — `engine/lineByLineAgent.ts`

ADR-005 contract, mirroring `explanationAgent.ts`:

- **Rule 1 — Input guard.** Throw `LineByLineTooLargeError` for blocks > `maxBlockLines` (default 200). Per-line is more expensive than per-block; the threshold is lower than `DEFAULT_MAX_SEGMENT_LINES = 400`.
- **Rule 2 — Parse.** `JSON.parse` the response. Failure → `ValidationFailure` "response is not valid JSON".
- **Rule 3 — Per-item validate.** For each annotation: `typeof line === "number"`, integer, in `[segment.startLine, segment.endLine]`. `typeof short === "string"`, non-empty, ≤ 60 chars, no `Here is...`/`Sure...` preamble. `typeof full === "string"`, non-empty, no leading code fence. (Code fences are not banned in the body, just at position 0.)
- **Rule 4 — Cross-item validate.** Sorted ascending by `line`. No duplicate `line` values. Optional warning if coverage > 90% (sign the model is annotating obvious lines).
- **Rule 5 — Single retry.** First retry threads the failure reason into the system prompt suffix.
- **Rule 6 — Diagnostics.** `[lineByLine] segmentId=… annotations=… retryFired=… modelTimeMs=…` log line via injected logger.
- **Rule 7 — Eval harness.** `test/eval/lineByLineEval.test.ts`, env-gated.

```ts
export const LINE_BY_LINE_PROMPT_VERSION = "v1";
export const DEFAULT_MAX_BLOCK_LINES = 200;

export class LineByLineTooLargeError extends Error { /* ... */ }

export interface LineByLineDeps {
  readonly adapter: LLMAdapter;
  readonly promptsDir: string;
  readonly logger?: (msg: string) => void;
  readonly token?: vscode.CancellationToken;
  readonly maxBlockLines?: number;
  readonly structuredOutputMode?: "json_object" | "json_schema";
}

export async function annotate(
  segment: Segment,
  deps: LineByLineDeps,
): Promise<LineByLine> { /* ... */ }
```

No streaming variant — `adapter.complete` only.

### 4. Store — `engine/lineByLineStore.ts`

Same shape as `ExplanationStore`. Keys `lineByLine:${preset}:${promptVersion}:${segmentId}`. Rehydrate sweep drops entries whose `promptVersion` != current.

```ts
export class LineByLineStore implements vscode.Disposable {
  get(segmentId, preset, version): LineByLine | undefined;
  set(segmentId, preset, version, value: LineByLine): void;
  clear(): void;
}
```

### 5. Decorator — `editor/lineByLineDecorator.ts`

```ts
export class LineByLineDecorator implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;
  private readonly active = new Map<string, Map<number, string>>(); // uriString → line → full
  private readonly visibleRanges = new Map<string, vscode.DecorationOptions[]>();
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    // ONE type, reused. design-doc §12.5.
    this.type = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 2em",
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
      },
    });
    this.subs.push(
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const ed of editors) this.applyToEditor(ed);
      }),
    );
  }

  apply(uri: vscode.Uri, annotations: LineAnnotation[]): void {
    const opts = annotations.map(a => ({
      range: new vscode.Range(a.line - 1, 0, a.line - 1, Number.MAX_SAFE_INTEGER),
      renderOptions: { after: { contentText: `// ${a.short}` } },
    }));
    this.visibleRanges.set(uri.toString(), opts);

    const fullMap = new Map<number, string>();
    for (const a of annotations) fullMap.set(a.line, a.full);
    this.active.set(uri.toString(), fullMap);

    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri.toString()) {
        ed.setDecorations(this.type, opts);
      }
    }
  }

  clear(uri: vscode.Uri): void {
    this.visibleRanges.delete(uri.toString());
    this.active.delete(uri.toString());
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri.toString()) {
        ed.setDecorations(this.type, []);
      }
    }
  }

  clearAll(): void {
    const uris = Array.from(this.visibleRanges.keys());
    this.visibleRanges.clear();
    this.active.clear();
    for (const ed of vscode.window.visibleTextEditors) {
      if (uris.includes(ed.document.uri.toString())) {
        ed.setDecorations(this.type, []);
      }
    }
  }

  hasUri(uri: vscode.Uri): boolean { return this.active.has(uri.toString()); }
  fullForLine(uri: vscode.Uri, line: number): string | undefined {
    return this.active.get(uri.toString())?.get(line);
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const opts = this.visibleRanges.get(editor.document.uri.toString());
    if (opts) editor.setDecorations(this.type, opts);
  }

  dispose(): void {
    this.type.dispose();
    for (const s of this.subs) s.dispose();
    this.active.clear();
    this.visibleRanges.clear();
  }
}
```

**Critical:** the type is created once. Per-range `renderOptions.after.contentText` carries the short text. The leaks listed in design-doc §12.5 happen when callers create a fresh `TextEditorDecorationType` per range — we never do.

### 6. Hover provider — `providers/lineByLineHoverProvider.ts`

```ts
export class LineByLineHoverProvider implements vscode.HoverProvider {
  constructor(private readonly decorator: LineByLineDecorator) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const full = this.decorator.fullForLine(doc.uri, pos.line + 1);
    if (!full) return undefined;
    const md = new vscode.MarkdownString(full, true);
    md.isTrusted = false;
    md.supportHtml = false;
    return new vscode.Hover(md, doc.lineAt(pos.line).range);
  }
}
```

Registered with `vscode.languages.registerHoverProvider({ scheme: "file" }, provider)`. The decorator's `active` map is the source of truth for "is there a hover here" — no duplication.

### 7. Toggle command + thread title button

**`codewalk.toggleLineByLine`** registered in `extension.ts`. Argument: the `vscode.CommentThread` passed by VS Code's menu system.

```ts
const toggleCommand = vscode.commands.registerCommand(
  "codewalk.toggleLineByLine",
  async (thread: vscode.CommentThread | undefined) => {
    const segmentId = commentController?.openSegmentId();
    const segment = segmentId ? findSegment(store, segmentId) : undefined;
    const uri = thread?.uri ?? (segmentId ? findUriForSegment(store, segmentId) : undefined);
    if (!segment || !uri || !segmentId) return;

    if (lineByLineDecorator.hasUri(uri)) {
      lineByLineDecorator.clear(uri);
      commentController?.setLineByLineFlag(false);
      return;
    }

    const cached = lineByLineStore.get(segmentId, resolved.backend, LINE_BY_LINE_PROMPT_VERSION);
    if (cached) {
      lineByLineDecorator.apply(uri, cached.annotations);
      commentController?.setLineByLineFlag(true);
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "CodeWalk: line-by-line…", cancellable: true },
      async (_progress, token) => {
        try {
          const result = await annotate(segment, {
            adapter, promptsDir, logger, token,
            structuredOutputMode: resolved.structuredOutputMode,
          });
          lineByLineStore.set(segmentId, resolved.backend, LINE_BY_LINE_PROMPT_VERSION, result);
          lineByLineDecorator.apply(uri, result.annotations);
          commentController?.setLineByLineFlag(true);
        } catch (err) {
          handleLineByLineError(err);
        }
      },
    );
  },
);
```

**`package.json` menu contribution:**

```json
"menus": {
  "comments/commentThread/title": [
    {
      "command": "codewalk.toggleLineByLine",
      "when": "commentController == codewalk",
      "group": "inline@1"
    }
  ]
}
```

**`CommentController.expand`** sets the thread's `contextValue` to `"codewalk.thread"` so the menu's `when` clause can target it specifically. Add `setLineByLineFlag(on: boolean)` so the controller can flip the thread's contextValue between `codewalk.thread` and `codewalk.thread.lineByLine` if we want different button labels later. (Phase 4 keeps it as one button "Toggle Line-by-Line" — `codewalk.thread` is enough.)

### 8. End Walkthrough lifecycle

`endWalkthrough` already calls `commentController.collapse()`, `store.clearAll()`, `walkSession.end()`. Add `lineByLineDecorator.clearAll()` so per-line decorations vanish.

### 9. Eval harness

`test/eval/lineByLineEval.test.ts`:

```ts
suite.skip("evaluates line-by-line annotations against a real backend", () => {
  if (!process.env.EVAL_LINEBYLINE) return;
  // pick a known block from sample.ts
  // run agent against real backend
  // assert: ≥ 30% line coverage, every short ≤ 60 chars, no duplicates,
  //         every line within block range.
});
```

Loose thresholds — the goal is to catch catastrophic regressions (no annotations at all, all annotations on the same line, shorts wildly over budget), not to enforce a pass/fail.

---

## Sequencing

Recommended order (within a single sprint, all on `phase2c-narrative-and-nav`):

| # | Component | Why this order |
|---|---|---|
| 1 | Types + prompt | No dependencies; everything reads from these. |
| 2 | Agent | Types + prompt locked. Validate with unit tests. |
| 3 | Store | Independent of decorator/hover. |
| 4 | Decorator | Needed by hover provider. |
| 5 | Hover provider | Reads from decorator. |
| 6 | Wire toggle command | Pulls all four together. |
| 7 | Thread contextValue + menu | Surfaces the command in UI. |
| 8 | End Walkthrough integration | One-line addition. |
| 9 | Unit tests + eval harness | Lock contracts. |
| 10 | tsc + esbuild + compile-tests verification | Per project_vscode_test_wedge.md. |
| 11 | PROJECT_STATE update + commit | Phase boundary. |

---

## Risks

- **Decoration leak.** Mitigated by single-`TextEditorDecorationType` design above. Test asserts the decorator only ever creates one type regardless of how many `apply()` calls it gets.
- **HoverProvider over-firing.** Registering globally on `{scheme: "file"}` means our provider runs on every hover in every file. The `decorator.fullForLine` lookup is O(1) — should be cheap. If it shows up in profiles, narrow the registration filter or check `decorator.hasUri` first.
- **Line-numbering drift.** If the user edits the file after annotations are computed, line numbers go stale. Phase 4 keeps it simple: edits invalidate visually (decorations stay attached to their original ranges, so they may sit on the wrong line). Mitigation deferred — this is the same fragility as the existing block highlights, and is acceptable for an MVP demo. Document in PROJECT_STATE.
- **Agent latency.** Per-line is more tokens than the summary — expect 5–15s on Anthropic Sonnet for a 50-line block. Progress notification is cancellable so the user is never stuck.
- **`short` overflows the editor width.** The `after.contentText` renders without wrapping. 60 chars is conservative on modern editors. The hover catches anything that needs more room.
- **Cancellation mid-fetch.** The progress token wires into the agent's `token` param; cancellation throws `CancelledError` which the command handler swallows silently per existing conventions.

---

## Verification

Manual checklist (appended to `docs/PROJECT_STATE.md`):

1. Open `codewalk/test/fixtures/sample.ts`. Run **Start CodeWalk**. Click any non-trivial CodeLens — the existing summary panel opens.
2. The thread title bar shows a new **inline button**. Click it. Progress notification appears: "CodeWalk: line-by-line…".
3. Within ~5–10s the panel stays as-is and **inline grey italic annotations** appear next to each annotated line in the block.
4. Hover over an annotated line. A **markdown tooltip** appears with the full explanation.
5. Hover over a non-annotated line. **No tooltip** (the hover provider returns undefined).
6. Click the button again. The annotations **disappear**.
7. Click again — annotations re-appear **instantly** (cached).
8. Run **CodeWalk: Reset Explanation Cache**. The line-by-line cache is independent — annotations still re-appear instantly. (This is intentional — the explanation cache controls only the summary.)
9. Run **CodeWalk: End Walkthrough**. **All decorations** disappear (block highlights AND line-by-line).
10. Hover an annotated-but-now-cleared line — no tooltip (the decorator's map is cleared).
11. Re-segment, re-expand, re-toggle — works fresh. No memory leak observed (one `TextEditorDecorationType` for the lifetime of the extension).
12. Repeat on a 200+ line block — `LineByLineTooLargeError` fires; user-facing toast says block is too long.
13. Re-run on a freshly-edited block (after segmenter re-runs) — new `segmentId`, new annotations, no stale cache.

Build verification:
```
cd codewalk && npx tsc --noEmit && npm run build && npm run compile-tests
```

All three must complete clean. F5 EDH for the manual checklist.

---

## Followups (post-Phase-4)

- **Phase 5 — Cross-file intelligence.** Spec parked in `docs/POST_MVP_VISION.md`. Phase 4's `full` markdown bodies are the natural seam for command-URI links to jump-to-definition once Phase 5 lands.
- **Edit-aware annotation invalidation.** When the user edits the file, line numbers drift. Could either (a) attach decorations via `vscode.TextDocumentChangeEvent` listener that shifts ranges, or (b) invalidate annotations whose block range is touched. Defer until users complain.
- **Per-file dispose policy revisit.** UX call still pending.
