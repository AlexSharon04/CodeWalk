# Phase 2b — Adaptive Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 explanation schema (`summary` + `pointsToConsider` + `concepts`) with a flat, kind-aware v2 schema (`kind` + `purpose` + `flow` + `uses` + `produces` + `watch` + `concepts`), add a zero-LLM fast path for trivial segments, and eagerly pre-populate the cache with trivial syntheses at segmentation time.

**Architecture:** Strict evolution of `explanationAgent.ts` — keep the ADR-005 pipeline shape (input guard → parse → per-item → cross-item → retry → logger → eval), swap the schema, add a kind-aware normalizer, and branch to `synthesizeTrivial(segment)` when `segment.difficulty === "trivial"`. Cache invalidation via `EXPLANATION_PROMPT_VERSION` bump v1→v2 (existing `ExplanationStore.rehydrate` sweep drops v1 entries for free). No new modules, no new settings, no new error types.

**Tech Stack:** TypeScript 5.3, VS Code Extension API ≥ 1.85, Mocha, esbuild. Unchanged from Phase 2.

**Spec:** `docs/superpowers/specs/2026-04-20-codewalk-phase2b-adaptive-explanation.md`

**Baseline assumption:** Start this plan on a clean working copy (phase2b spec already committed at `30cd3dd`). Any pre-existing uncommitted modifications on the branch are outside this plan's scope.

---

## File Structure

**Modified files:**

| File | Change |
|---|---|
| `codewalk/src/types/index.ts` | `Explanation` type rewritten: `kind` + flat fields, `summary`/`pointsToConsider` removed. |
| `codewalk/src/engine/explanationAgent.ts` | `EXPLANATION_PROMPT_VERSION "v1"→"v2"`; `EXPLANATION_JSON_SCHEMA` rewritten; `extractPartialSummary`→`extractPartialPurpose`; `synthesizeTrivial(segment)` added; `explain` short-circuits on trivial; `validateResponse` rewritten with kind-aware normalizer; `difficulty` passed into prompt. |
| `codewalk/src/engine/explanationStore.ts` | `isDoneExplanation` updated to v2 shape. |
| `codewalk/src/engine/prefetchQueue.ts` | Streaming-placeholder object updated to v2 shape; trivial-difficulty segments skipped (already pre-populated). |
| `codewalk/src/providers/commentController.ts` | `renderExplanation` rewritten for kind-aware Markdown layout; `onPartial` updates `purpose` instead of `summary`; streaming-placeholder object updated to v2 shape; loader-frame uses `purpose`. |
| `codewalk/src/extension.ts` | After segmentation completion (via `segmentStore.onDidChange`), eagerly synthesize explanations for every trivial-difficulty segment and write them to `explanationStore` as `renderState: "done"`. |
| `codewalk/prompts/explanation.md` | Rewritten: per-kind rules, new schema in system half, `difficulty` variable in user half. |
| `codewalk/test/suite/explanationAgent.test.ts` | Tests updated to v2 shape; new suites for `synthesizeTrivial`, kind-normalization, trivial short-circuit. |
| `codewalk/test/suite/explanationStore.test.ts` | `fakeExplanation` helper (if present) updated; round-trip test covers v2 fields. |
| `codewalk/test/suite/commentController.test.ts` | `fakeExplanation` helper updated; tests for new rendering layout. |
| `codewalk/test/suite/prefetchQueue.test.ts` | `fakeExplanation`/placeholder helpers updated; new test for trivial-segment skipping. |
| `codewalk/test/eval/explanationEval.test.ts` | `Fixture` type gains `expectedKind?`; `allText` scan uses new fields. |
| `codewalk/test/integration/explanationLive.test.ts` | Assertions updated for v2 shape. |
| `docs/PROJECT_STATE.md` | Recent decisions + Phase 2b manual verification checklist appended. |

**No new files. No deleted files.**

---

## Task 1: Bump `EXPLANATION_PROMPT_VERSION` to `"v2"` (drives cache invalidation)

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts:13`

This first — in isolation — so the existing `ExplanationStore.rehydrate` sweep has a new version to compare against once the rest of the schema lands. On its own, this change invalidates any cached explanations but keeps the code compiling. Commit before touching the schema.

- [ ] **Step 1: Find the constant**

Confirm line 13 of `codewalk/src/engine/explanationAgent.ts` reads:
```ts
export const EXPLANATION_PROMPT_VERSION = "v1";
```

- [ ] **Step 2: Change the string**

Edit `codewalk/src/engine/explanationAgent.ts:13`:
```ts
export const EXPLANATION_PROMPT_VERSION = "v2";
```

- [ ] **Step 3: Run existing tests — should all still pass**

Run: `cd codewalk && npm run pretest && npm test`
Expected: all existing tests pass. (The constant is opaque to test logic; they reference it by import not by value.)

- [ ] **Step 4: Commit**

```bash
git add codewalk/src/engine/explanationAgent.ts
git commit -m "phase2b/step1: bump EXPLANATION_PROMPT_VERSION v1 -> v2"
```

---

## Task 2: Rewrite the `Explanation` TypeScript type

**Files:**
- Modify: `codewalk/src/types/index.ts`

This is the type-system change that flips the schema. Everything downstream will fail to compile — that's expected and guides the next tasks. `Concept` stays unchanged.

- [ ] **Step 1: Write the new type**

Replace the body of `codewalk/src/types/index.ts` starting at line 13 with:

```ts
export interface Concept {
  name: string;
  briefExplainer: string;
  relevance: string;
}

export type ExplanationKind = "trivial" | "logic" | "io";

export interface Explanation {
  segmentId: string;
  kind: ExplanationKind;
  purpose: string;
  flow: string[];
  uses: string[];
  produces: string[];
  watch: string[];
  concepts: Concept[];
  renderState: "streaming" | "done" | "error";
}
```

Leave `Difficulty` and `Segment` alone.

- [ ] **Step 2: Run the TypeScript compiler to see the expected breakage**

Run: `cd codewalk && npm run compile-tests`
Expected: MANY compile errors — references to `Explanation.summary`, `Explanation.pointsToConsider`, etc. in `explanationAgent.ts`, `explanationStore.ts`, `commentController.ts`, `prefetchQueue.ts`, and several test files. This is intentional — the next tasks fix each consumer in turn.

- [ ] **Step 3: Do NOT commit yet**

The next several tasks restore the build. Commit only when `npm run compile-tests` is clean.

---

## Task 3: Rewrite `EXPLANATION_JSON_SCHEMA` to match v2

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts:17-51`

Replace the v1 schema constant with the flat v2 schema. `strict: true` preserved.

- [ ] **Step 1: Replace the schema constant**

Replace lines 17–51 of `codewalk/src/engine/explanationAgent.ts` with:

```ts
export const EXPLANATION_JSON_SCHEMA: JsonSchemaSpec = {
  name: "codewalk_explanation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["trivial", "logic", "io"] },
      purpose: { type: "string" },
      flow: { type: "array", items: { type: "string" } },
      uses: { type: "array", items: { type: "string" } },
      produces: { type: "array", items: { type: "string" } },
      watch: { type: "array", items: { type: "string" } },
      concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            briefExplainer: { type: "string" },
            relevance: { type: "string" },
          },
          required: ["name", "briefExplainer", "relevance"],
          additionalProperties: false,
        },
      },
    },
    required: ["kind", "purpose", "flow", "uses", "produces", "watch", "concepts"],
    additionalProperties: false,
  },
};
```

- [ ] **Step 2: Confirm the schema object still typechecks against `JsonSchemaSpec`**

Run: `cd codewalk && npx tsc -p ./ --noEmit 2>&1 | head -80`
Expected: errors reference OTHER locations (`validateResponse`, `extractPartialSummary`, etc.) — not this constant.

---

## Task 4: Rename and re-tune `extractPartialSummary` → `extractPartialPurpose`

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts:53-63`

The streaming regex now targets `"purpose"` instead of `"summary"`. Same mechanism, different field name.

- [ ] **Step 1: Rewrite the extractor**

Replace lines 53–63 of `codewalk/src/engine/explanationAgent.ts`:

```ts
const PURPOSE_RE = /"purpose"\s*:\s*"((?:[^"\\]|\\.)*)/;

export function extractPartialPurpose(buffer: string): string | undefined {
  const match = PURPOSE_RE.exec(buffer);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Update any imports of the old name within the file**

Search the file for `extractPartialSummary` and update every reference (there should be one — inside `explain`'s streaming path). Rename it to `extractPartialPurpose` in place.

- [ ] **Step 3: Update the streaming-path `onPartial` call inside `explain`**

Find the line in `codewalk/src/engine/explanationAgent.ts` (near line 228) that looks like:
```ts
const partial = extractPartialSummary(buffer);
```
Replace with:
```ts
const partial = extractPartialPurpose(buffer);
```

And find the `deps.onPartial({ summary: partial });` call a few lines below. Replace with:
```ts
deps.onPartial({ purpose: partial });
```

- [ ] **Step 4: Update the `ExplanationDeps.onPartial` signature**

At `codewalk/src/engine/explanationAgent.ts:99`, change:
```ts
readonly onPartial?: (partial: { summary?: string }) => void;
```
to:
```ts
readonly onPartial?: (partial: { purpose?: string }) => void;
```

---

## Task 5: Add `synthesizeTrivial` and the trivial short-circuit inside `explain`

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts`
- Test: `codewalk/test/suite/explanationAgent.test.ts`

Introduces the zero-LLM path. This task is TDD — tests first, then implementation.

- [ ] **Step 1: Write failing tests**

Append to `codewalk/test/suite/explanationAgent.test.ts` (before the final close-bracket of the file):

```ts
suite("synthesizeTrivial", () => {
  test("returns kind=trivial with purpose from oneLiner and empty arrays", async () => {
    const { synthesizeTrivial } = await import("../../src/engine/explanationAgent");
    const seg = fakeSegment({ difficulty: "trivial", oneLiner: "Imports for core utilities." });
    const exp = synthesizeTrivial(seg);
    assert.strictEqual(exp.kind, "trivial");
    assert.strictEqual(exp.purpose, "Imports for core utilities.");
    assert.deepStrictEqual(exp.flow, []);
    assert.deepStrictEqual(exp.uses, []);
    assert.deepStrictEqual(exp.produces, []);
    assert.deepStrictEqual(exp.watch, []);
    assert.deepStrictEqual(exp.concepts, []);
    assert.strictEqual(exp.renderState, "done");
    assert.strictEqual(exp.segmentId, seg.id);
  });
});

suite("explain trivial fast path", () => {
  test("returns synthesized explanation without calling the adapter when difficulty is trivial", async () => {
    let adapterCalled = false;
    const adapter: LLMAdapter = {
      async complete() { adapterCalled = true; return "{}"; },
      async *completeStream() { adapterCalled = true; yield "{}"; },
    };
    const seg = fakeSegment({ difficulty: "trivial", oneLiner: "Trivial one-liner." });
    const exp = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(adapterCalled, false);
    assert.strictEqual(exp.kind, "trivial");
    assert.strictEqual(exp.purpose, "Trivial one-liner.");
    assert.strictEqual(exp.renderState, "done");
  });
});
```

- [ ] **Step 2: Run tests — synthesizeTrivial suite should fail (not exported)**

Run: `cd codewalk && npm run pretest && npm test -- --grep synthesizeTrivial`
Expected: FAIL — `synthesizeTrivial` not exported from the module.

- [ ] **Step 3: Implement `synthesizeTrivial`**

Add to `codewalk/src/engine/explanationAgent.ts`, right above the `explain` function:

```ts
export function synthesizeTrivial(segment: Segment): Explanation {
  return {
    segmentId: segment.id,
    kind: "trivial",
    purpose: segment.oneLiner,
    flow: [],
    uses: [],
    produces: [],
    watch: [],
    concepts: [],
    renderState: "done",
  };
}
```

- [ ] **Step 4: Add the short-circuit inside `explain`**

At the start of `explain` in `codewalk/src/engine/explanationAgent.ts` (just after the input-guard block that throws `SegmentTooLargeError`), insert:

```ts
if (segment.difficulty === "trivial") {
  const exp = synthesizeTrivial(segment);
  const modelTimeMs = Date.now() - startMs;
  deps.logger?.(
    `[explanation] segmentId=${segment.id} kind=trivial purpose=${exp.purpose.length}ch modelTimeMs=${modelTimeMs} source=synth`,
  );
  return exp;
}
```

(Move the `const startMs = Date.now();` line above this block so the timing log has a value; or hard-code `modelTimeMs=0` for synth entries — either works, but make the choice consistent with the log format.)

- [ ] **Step 5: Run the tests**

Run: `cd codewalk && npm run pretest && npm test -- --grep "synthesizeTrivial\|trivial fast path"`
Expected: both new tests PASS.

- [ ] **Step 6: Do NOT commit yet**

Build is still broken elsewhere. The next few tasks restore it.

---

## Task 6: Update `validateResponse` for the v2 schema with kind-aware normalization

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts:319-387` (the `validateResponse` and `filterPtcItems` helpers)
- Modify: the `RawExplanation` interface and per-item constants near line 135

Replaces the full body of validation logic. Preserves the retry/threaded-reason mechanism untouched (that's in the caller, `explain`, above this).

- [ ] **Step 1: Replace the `RawExplanation` interface**

Find at `codewalk/src/engine/explanationAgent.ts` (around line 135):
```ts
interface RawExplanation {
  summary?: unknown;
  pointsToConsider?: { ... };
  concepts?: unknown;
}
```

Replace with:
```ts
interface RawExplanation {
  kind?: unknown;
  purpose?: unknown;
  flow?: unknown;
  uses?: unknown;
  produces?: unknown;
  watch?: unknown;
  concepts?: unknown;
}
```

- [ ] **Step 2: Replace constants near line 148**

Keep `MIN_SUMMARY_LEN` renamed and the others intact:

```ts
const GENERIC_PTC_RE = /^(be careful|make sure|consider|note that|avoid|watch out|don['’]t forget)\b/i;
const MIN_PURPOSE_LEN = 20;
const MIN_LIST_ITEM_LEN = 15;
const CAP_FLOW = 5;
const CAP_USES = 5;
const CAP_PRODUCES = 3;
const CAP_WATCH = 3;
const CAP_CONCEPTS = 3;
```

Delete the old `MIN_SUMMARY_LEN` and `MIN_PTC_ITEM_LEN` constants.

- [ ] **Step 3: Rewrite `validateResponse`**

Replace the full body of `validateResponse` (around line 319) with:

```ts
function validateResponse(raw: string, segment: Segment, logger?: ExplanationLogger): {
  kind: ExplanationKind;
  purpose: string;
  flow: string[];
  uses: string[];
  produces: string[];
  watch: string[];
  concepts: Concept[];
} {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }

  if (obj.kind !== "trivial" && obj.kind !== "logic" && obj.kind !== "io") {
    throw new ValidationFailure("kind is missing or not one of trivial|logic|io");
  }
  const kind: ExplanationKind = obj.kind;

  if (typeof obj.purpose !== "string" || obj.purpose.length < MIN_PURPOSE_LEN) {
    throw new ValidationFailure(`purpose is missing or shorter than ${MIN_PURPOSE_LEN} chars`);
  }
  if (obj.purpose.trim().toLowerCase() === segment.oneLiner.trim().toLowerCase()) {
    throw new ValidationFailure("purpose is identical to segment.oneLiner — expand on it, don't echo it");
  }

  // Per-item filter + cap, with dropped-item diagnostic.
  const flow = capAndFilter(obj.flow, CAP_FLOW, logger, "flow");
  const uses = capAndFilter(obj.uses, CAP_USES, logger, "uses");
  const produces = capAndFilter(obj.produces, CAP_PRODUCES, logger, "produces");
  const watch = capAndFilter(obj.watch, CAP_WATCH, logger, "watch");

  const conceptsRaw = Array.isArray(obj.concepts) ? obj.concepts : [];
  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const c of conceptsRaw) {
    if (concepts.length >= CAP_CONCEPTS) {
      logger?.(`[explain-diag] concept dropped: cap ${CAP_CONCEPTS} reached`);
      continue;
    }
    if (!c || typeof (c as any).name !== "string" || (c as any).name.length === 0) continue;
    if (typeof (c as any).briefExplainer !== "string" || (c as any).briefExplainer.length === 0) continue;
    if (typeof (c as any).relevance !== "string" || (c as any).relevance.length === 0) continue;
    const key = (c as any).name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({
      name: (c as any).name,
      briefExplainer: (c as any).briefExplainer,
      relevance: (c as any).relevance,
    });
  }

  // Kind-aware cross-item normalization.
  if (kind === "trivial") {
    if (flow.length || uses.length || produces.length || watch.length || concepts.length) {
      logger?.(`[explanation] WARN trivial-kind returned populated arrays — normalizing to empty`);
    }
    return { kind, purpose: obj.purpose, flow: [], uses: [], produces: [], watch: [], concepts: [] };
  }

  // Non-trivial completeness check — the block should say SOMETHING about what it does.
  if (flow.length === 0 && watch.length === 0 && concepts.length === 0) {
    throw new ValidationFailure("non-trivial block emitted no flow, watch, or concepts");
  }

  return { kind, purpose: obj.purpose, flow, uses, produces, watch, concepts };
}

function capAndFilter(
  x: unknown,
  cap: number,
  logger: ExplanationLogger | undefined,
  fieldName: string,
): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  let dropped = 0;
  for (const s of x) {
    if (out.length >= cap) { dropped++; continue; }
    if (typeof s !== "string") { dropped++; continue; }
    if (s.length < MIN_LIST_ITEM_LEN) { dropped++; continue; }
    if (GENERIC_PTC_RE.test(s.trim())) { dropped++; continue; }
    out.push(s);
  }
  if (dropped > 0) {
    logger?.(`[explain-diag] ${fieldName}: dropped ${dropped} items (cap ${cap})`);
  }
  return out;
}
```

Remove the old `filterPtcItems` function — replaced by `capAndFilter`.

- [ ] **Step 4: Update the `explain` caller's return construction**

Find the `return { segmentId, summary, pointsToConsider, concepts, renderState }` block around line 273 and replace with:

```ts
return {
  segmentId: segment.id,
  kind: validated.kind,
  purpose: validated.purpose,
  flow: validated.flow,
  uses: validated.uses,
  produces: validated.produces,
  watch: validated.watch,
  concepts: validated.concepts,
  renderState: "done",
};
```

- [ ] **Step 5: Update the diagnostic log line inside `explain`**

Find the `deps.logger?.(` block near line 265 that logs summary/assumptions/dangers/sideEffects/concepts. Replace with:

```ts
deps.logger?.(
  `${prefix} segmentId=${segment.id} kind=${validated.kind} purpose=${validated.purpose.length}ch `
  + `flow=${validated.flow.length} uses=${validated.uses.length} produces=${validated.produces.length} `
  + `watch=${validated.watch.length} concepts=${validated.concepts.length} `
  + `modelTimeMs=${modelTimeMs} retryFired=${retryFired} source=llm`,
);
```

- [ ] **Step 6: Add the `ExplanationKind` import at the top of the file**

Update line 2:
```ts
import type { Explanation, ExplanationKind, Segment, Concept } from "../types";
```

---

## Task 7: Update `isDoneExplanation` in `ExplanationStore`

**Files:**
- Modify: `codewalk/src/engine/explanationStore.ts:11-24`

Port the type guard to the v2 shape.

- [ ] **Step 1: Replace the guard**

Replace lines 11–24 of `codewalk/src/engine/explanationStore.ts`:

```ts
function isDoneExplanation(x: unknown): x is Explanation {
  if (!x || typeof x !== "object") return false;
  const o = x as Explanation;
  return (
    typeof o.segmentId === "string"
    && (o.kind === "trivial" || o.kind === "logic" || o.kind === "io")
    && typeof o.purpose === "string"
    && Array.isArray(o.flow)
    && Array.isArray(o.uses)
    && Array.isArray(o.produces)
    && Array.isArray(o.watch)
    && Array.isArray(o.concepts)
    && o.renderState === "done"
  );
}
```

No other changes to this file.

---

## Task 8: Update `PrefetchQueue` streaming-placeholder shape + skip trivial segments

**Files:**
- Modify: `codewalk/src/engine/prefetchQueue.ts`

The placeholder the prefetch queue writes before invoking the agent still uses the v1 shape. Update it. Also add a `difficulty === "trivial"` filter since those are already pre-populated.

- [ ] **Step 1: Replace the placeholder object at line 78-84**

Replace:
```ts
this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, {
  segmentId: job.segment.id,
  summary: "",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
  renderState: "streaming",
});
```

With:
```ts
this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, {
  segmentId: job.segment.id,
  kind: "logic",  // best-guess placeholder; overwritten by the final explain() result
  purpose: "",
  flow: [],
  uses: [],
  produces: [],
  watch: [],
  concepts: [],
  renderState: "streaming",
});
```

- [ ] **Step 2: Add trivial-skip to the `needsFetch` filter around line 43**

Replace:
```ts
const needsFetch = segments.filter(seg => {
  const cached = this.deps.explanationStore.get(seg.id, this.deps.preset, this.deps.promptVersion);
  return !cached || cached.renderState !== "done";
});
```

With:
```ts
const needsFetch = segments.filter(seg => {
  if (seg.difficulty === "trivial") return false; // eagerly synthesized at segmentation — already cached
  const cached = this.deps.explanationStore.get(seg.id, this.deps.preset, this.deps.promptVersion);
  return !cached || cached.renderState !== "done";
});
```

---

## Task 9: Update `CodeWalkCommentController` — placeholder shape, `onPartial` wiring, renderer, loader frame

**Files:**
- Modify: `codewalk/src/providers/commentController.ts`

Four surgical edits: the streaming-placeholder `set` call, the `onPartial` body, the `renderLoaderFrame` reference to `exp.summary`, and the `renderExplanation` function at the bottom.

- [ ] **Step 1: Update the streaming-placeholder at line 159-165**

Replace:
```ts
this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
  segmentId,
  summary: "",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
  renderState: "streaming",
});
```

With:
```ts
this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
  segmentId,
  kind: "logic",
  purpose: "",
  flow: [],
  uses: [],
  produces: [],
  watch: [],
  concepts: [],
  renderState: "streaming",
});
```

- [ ] **Step 2: Update `onPartial` body at line 175-183**

Replace:
```ts
onPartial: partial => {
  const current = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
  if (!current) return;
  this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
    ...current,
    summary: partial.summary ?? current.summary,
    renderState: "streaming",
  });
},
```

With:
```ts
onPartial: partial => {
  const current = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
  if (!current) return;
  this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
    ...current,
    purpose: partial.purpose ?? current.purpose,
    renderState: "streaming",
  });
},
```

- [ ] **Step 3: Update `renderLoaderFrame` at line 88-105**

Replace the body:
```ts
const exp = this.expStore.get(this.openSegment.id, this.deps.preset, this.deps.promptVersion);
const summary = exp?.summary ?? "";
```

With:
```ts
const exp = this.expStore.get(this.openSegment.id, this.deps.preset, this.deps.promptVersion);
const partialPurpose = exp?.purpose ?? "";
```

Then replace both usages of `summary` later in the function:
```ts
if (summary.length === 0) {
  md.appendMarkdown(`_Analyzing${dots} (${secs}s)_`);
} else {
  md.appendMarkdown(summary);
  md.appendMarkdown(`\n\n---\n\n_Gathering details${dots} (${secs}s)_`);
}
```

With:
```ts
if (partialPurpose.length === 0) {
  md.appendMarkdown(`_Analyzing${dots} (${secs}s)_`);
} else {
  md.appendMarkdown(`**${partialPurpose}**`);
  md.appendMarkdown(`\n\n---\n\n_Gathering details${dots} (${secs}s)_`);
}
```

- [ ] **Step 4: Rewrite `renderExplanation` at lines 248-279**

Replace the entire function with:

```ts
function renderExplanation(exp: Explanation): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = false;

  // Streaming with no purpose yet.
  if (exp.renderState === "streaming" && !exp.purpose) {
    md.appendMarkdown("_Analyzing…_");
    return md;
  }

  // Trivial layout — one italic line, nothing else.
  if (exp.kind === "trivial") {
    md.appendMarkdown(`_${exp.purpose}_`);
    return md;
  }

  // Logic / io layout.
  md.appendMarkdown(`**${exp.purpose}**`);

  if (exp.renderState !== "done") return md;

  if (exp.flow.length) {
    md.appendMarkdown(`\n\n**Flow**\n${exp.flow.map(s => `- ${s}`).join("\n")}`);
  }
  if (exp.uses.length) {
    const items = exp.uses.map(s => `\`${s}\``).join(" · ");
    md.appendMarkdown(`\n\n**Uses** · ${items}`);
  }
  if (exp.produces.length) {
    const items = exp.produces.join(" · ");
    md.appendMarkdown(`\n\n**Produces** · ${items}`);
  }
  if (exp.watch.length) {
    md.appendMarkdown(`\n\n**Watch**\n${exp.watch.map(s => `- ${s}`).join("\n")}`);
  }
  if (exp.concepts.length) {
    const body = exp.concepts
      .map(c => `**${c.name}** — ${c.briefExplainer}\n\n_${c.relevance}_`)
      .join("\n\n");
    md.appendMarkdown(`\n\n<details><summary>Concepts (${exp.concepts.length})</summary>\n\n${body}\n\n</details>`);
  }
  return md;
}
```

- [ ] **Step 5: Verify compile**

Run: `cd codewalk && npm run compile-tests`
Expected: no errors in `commentController.ts`. Test files still have errors — fixed in later tasks.

---

## Task 10: Update `explanationAgent.test.ts` helpers and v2-schema tests

**Files:**
- Modify: `codewalk/test/suite/explanationAgent.test.ts`

Existing helper and test cases reference v1 fields. Port them to v2.

- [ ] **Step 1: Find the v1 test responses — every JSON response string embedded in tests**

Search the file for `"summary"` and `"pointsToConsider"`. Each match is a JSON string payload used as a mock LLM response. Replace each with a minimal v2-compliant payload. Example mapping:

v1 payload (typical):
```ts
const response = JSON.stringify({
  summary: "A sufficiently long summary that explains what's happening.",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
});
```

v2 payload (replacement):
```ts
const response = JSON.stringify({
  kind: "logic",
  purpose: "A sufficiently long purpose that explains the intent clearly.",
  flow: ["validate input arguments", "compute the result"],
  uses: [],
  produces: [],
  watch: [],
  concepts: [],
});
```

Apply this shape to every response literal in the file. Specific tests to update (by existing-test name):
- `"completes successfully on the happy path"`
- `"fires a retry on validation failure and succeeds on the retry"`
- `"throws MalformedResponseError after two failed JSON attempts"`
- `"rejects summary shorter than 20 chars"` — rename to `"rejects purpose shorter than 20 chars"`, update payload to have short `purpose`
- `"rejects summary identical to oneLiner"` — rename to `"rejects purpose identical to oneLiner"`
- `"drops PTC items that match the generic-phrase regex"` — rename to `"drops list items that match the generic-phrase regex"`, move the generic items into `watch`
- `"dedupes duplicate concept names"` — same shape, just add the other v2 fields
- Any test that asserts on `exp.summary` or `exp.pointsToConsider.*` — update to `exp.purpose` / `exp.watch` / etc.

- [ ] **Step 2: Run the agent tests**

Run: `cd codewalk && npm run pretest && npm test -- --grep "explanation"`
Expected: most pass. Any failures report exactly which test still references old names — fix them.

- [ ] **Step 3: Add new tests for kind-aware normalization and completeness rule**

Append a new suite:

```ts
suite("v2 kind-aware validation", () => {
  test("kind=trivial with populated arrays is normalized to empty", async () => {
    const adapter = stubAdapter([JSON.stringify({
      kind: "trivial",
      purpose: "A short trivial purpose that is still 20+ characters long.",
      flow: ["this should be dropped"],
      uses: ["this too"],
      produces: [],
      watch: [],
      concepts: [{ name: "X", briefExplainer: "abc", relevance: "def" }],
    })]);
    const seg = fakeSegment({ difficulty: "standard" }); // not trivial — so we take the LLM path
    const exp = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(exp.kind, "trivial");
    assert.deepStrictEqual(exp.flow, []);
    assert.deepStrictEqual(exp.uses, []);
    assert.deepStrictEqual(exp.concepts, []);
  });

  test("kind=logic with empty flow+watch+concepts retries and fails", async () => {
    const emptyish = JSON.stringify({
      kind: "logic",
      purpose: "A 20+ character purpose that still populates nothing.",
      flow: [],
      uses: ["just-a-symbol"],
      produces: ["just-an-output"],
      watch: [],
      concepts: [],
    });
    const adapter = stubAdapter([emptyish, emptyish]);
    const seg = fakeSegment({ difficulty: "standard" });
    await assert.rejects(
      explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      (err: Error) => err instanceof MalformedResponseError,
    );
  });

  test("kind=io with only flow and uses passes validation", async () => {
    const adapter = stubAdapter([JSON.stringify({
      kind: "io",
      purpose: "An I/O block whose purpose is long enough for validation.",
      flow: ["connect to database", "issue query", "return rows"],
      uses: ["db.users.findOne"],
      produces: [],
      watch: [],
      concepts: [],
    })]);
    const seg = fakeSegment({ difficulty: "standard" });
    const exp = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(exp.kind, "io");
    assert.strictEqual(exp.flow.length, 3);
  });

  test("flow over 5 items is truncated to 5 without fatal error", async () => {
    const adapter = stubAdapter([JSON.stringify({
      kind: "logic",
      purpose: "A purpose that is 20+ characters long for validation.",
      flow: ["a".repeat(16), "b".repeat(16), "c".repeat(16), "d".repeat(16), "e".repeat(16), "f".repeat(16), "g".repeat(16)],
      uses: [],
      produces: [],
      watch: [],
      concepts: [],
    })]);
    const seg = fakeSegment({ difficulty: "standard" });
    const exp = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(exp.flow.length, 5);
  });

  test("kind value outside {trivial,logic,io} is rejected (triggers retry)", async () => {
    const bad = JSON.stringify({
      kind: "function", purpose: "A purpose 20+ chars long enough for validation here.",
      flow: [], uses: [], produces: [], watch: [], concepts: [],
    });
    const adapter = stubAdapter([bad, bad]);
    const seg = fakeSegment({ difficulty: "standard" });
    await assert.rejects(
      explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      (err: Error) => err instanceof MalformedResponseError,
    );
  });
});
```

- [ ] **Step 4: Run the new tests**

Run: `cd codewalk && npm run pretest && npm test -- --grep "v2 kind-aware\|synthesizeTrivial\|trivial fast path"`
Expected: all pass.

---

## Task 11: Update `explanationStore.test.ts` and `commentController.test.ts` helpers

**Files:**
- Modify: `codewalk/test/suite/explanationStore.test.ts`
- Modify: `codewalk/test/suite/commentController.test.ts`

Each file has a `fakeExplanation` helper that constructs a v1-shaped record. Update both.

- [ ] **Step 1: Update `fakeExplanation` in `commentController.test.ts` at line 22-30**

Replace:
```ts
function fakeExplanation(segId: string, state: Explanation["renderState"] = "done"): Explanation {
  return {
    segmentId: segId,
    summary: "This is a 20+char valid summary that explains what the block does.",
    pointsToConsider: { assumptions: ["Assumes input is valid JSON."], dangers: [], sideEffects: [] },
    concepts: [],
    renderState: state,
  };
}
```

With:
```ts
function fakeExplanation(segId: string, state: Explanation["renderState"] = "done"): Explanation {
  return {
    segmentId: segId,
    kind: "logic",
    purpose: "This is a 20+char valid purpose that explains the intent clearly.",
    flow: ["do the thing", "return the result"],
    uses: [],
    produces: [],
    watch: [],
    concepts: [],
    renderState: state,
  };
}
```

Also update the existing test `"onDidChange streaming updates mutate the open thread's body in place"` — the line `updated.summary = "Now with more characters streamed in for this block."` → `updated.purpose = "Now with more characters streamed in for this block."` and the `after!.includes("more characters streamed")` assertion still works because the new `renderLoaderFrame` renders `partialPurpose` verbatim.

- [ ] **Step 2: Check `explanationStore.test.ts` for v1 references**

Run: `grep -n "summary\|pointsToConsider" codewalk/test/suite/explanationStore.test.ts` (use the Grep tool, not shell grep).

For every match, update the payload to v2 shape (same translation pattern as Task 10 Step 1).

- [ ] **Step 3: Add a kind-aware round-trip test**

Append to `codewalk/test/suite/explanationStore.test.ts`:

```ts
test("round-trips a v2 explanation with kind and all arrays", () => {
  const ctx = makeContext();
  const store = new ExplanationStore(ctx, undefined, "v2");
  const exp: Explanation = {
    segmentId: "seg-1",
    kind: "io",
    purpose: "Reads config from disk at startup.",
    flow: ["read path", "parse JSON", "validate schema"],
    uses: ["fs.readFile", "path.join"],
    produces: ["config object"],
    watch: ["fails silently if file missing"],
    concepts: [],
    renderState: "done",
  };
  store.set("seg-1", "groq", "v2", exp);
  const got = store.get("seg-1", "groq", "v2");
  assert.deepStrictEqual(got, exp);
  store.dispose();
});
```

- [ ] **Step 4: Run both test files**

Run: `cd codewalk && npm run pretest && npm test -- --grep "ExplanationStore\|CodeWalkCommentController"`
Expected: all pass.

---

## Task 12: Update `prefetchQueue.test.ts` — helpers + new trivial-skip test

**Files:**
- Modify: `codewalk/test/suite/prefetchQueue.test.ts`

- [ ] **Step 1: Audit file for v1 shape**

Run: Grep the file for `summary` and `pointsToConsider`. Update each payload to v2 shape, same translation as Task 10.

- [ ] **Step 2: Add trivial-skip test**

Append:

```ts
test("skips trivial-difficulty segments — they're assumed pre-populated", async () => {
  let adapterCalls = 0;
  const adapter: LLMAdapter = {
    async complete() { adapterCalls++; return JSON.stringify({
      kind: "logic", purpose: "A 20+ char purpose that passes validation here.",
      flow: ["step"], uses: [], produces: [], watch: [], concepts: [],
    }); },
    async *completeStream() { adapterCalls++; yield ""; },
  };
  const ctx = makeContext();
  const store = new ExplanationStore(ctx, undefined, "v2");
  const queue = new PrefetchQueue({
    explanationStore: store,
    agentDeps: { adapter, promptsDir: "" },
    preset: "groq",
    promptVersion: "v2",
  });
  const trivialSeg: Segment = {
    id: "seg-triv", label: "imports", oneLiner: "Imports.",
    startLine: 1, endLine: 5, code: "", difficulty: "trivial",
  };
  queue.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [trivialSeg]);
  await queue.drain();
  assert.strictEqual(adapterCalls, 0);
  queue.dispose();
});
```

- [ ] **Step 3: Run prefetch tests**

Run: `cd codewalk && npm run pretest && npm test -- --grep "PrefetchQueue"`
Expected: all pass.

---

## Task 13: Rewrite `codewalk/prompts/explanation.md`

**Files:**
- Modify: `codewalk/prompts/explanation.md`

Full rewrite per spec §6. The user-half now includes a `{{difficulty}}` variable.

- [ ] **Step 1: Overwrite the prompt file**

Replace the entire contents of `codewalk/prompts/explanation.md` with:

```
You are CodeWalk's explanation agent. Given ONE code block plus its
surrounding file, produce a compact, programmer-oriented explanation.

Your target reader: an entry-level programmer trying to understand an
unfamiliar codebase quickly. They want bullets, not paragraphs. They
want specific symbols, not abstract descriptions. They want to know
what a block actually does and what to watch for — no filler.

First: classify the block as ONE of three kinds.
  - trivial: imports, config literals, type aliases, one-line helpers,
    pure boilerplate. If trivial, emit ONLY `kind` and `purpose` and
    leave all arrays empty.
  - io: any block whose primary work is network calls, database access,
    filesystem access, or external-API calls. In `uses`, name the
    SPECIFIC endpoint, table, or path — not abstractions.
  - logic: everything else — pure computation, control flow, validation,
    transforms, class-method bodies.

(Note: the orchestrator already handles truly trivial blocks locally.
You will usually be asked about logic or io blocks. Tag trivial only if
the block is genuinely boilerplate.)

For logic and io blocks:
  - purpose: ONE or TWO sentences stating the block's intent in
    programmer terms. Do not restate what the code literally says.
  - flow: 2–5 bullets. Logical steps, not line numbers. Phrase as
    "verb object" — "validate input", "fetch user row", "shape
    response". NOT "on line 14 we call…".
  - uses: 1–5 concrete symbols, functions, endpoints, or tables. Be
    specific: `db.users.findOne`, `POST /api/login`, `jwt.verify`. Not
    "database", not "authentication".
  - produces: 1–3 outputs or effects visible to callers or the outside
    world. Returned values, thrown errors, mutations, writes, prints.
  - watch: 0–3 SPECIFIC concerns. Zero is correct when the block has
    no real risks. NEVER fill to hit a quota. Bad: "be careful with
    SQL". Good: "line 14 concatenates req.body.email directly into the
    query — vulnerable to SQL injection".
  - concepts: 0–3 items ONLY if a learner would not know them. Skip
    basic syntax. Each concept: name, briefExplainer (2–3 sentences
    about the concept in general, self-contained), relevance (1
    sentence about why it matters HERE).

Respond with ONLY the raw JSON object matching the schema. No
preamble, no Markdown fence, no closing remarks.

Schema:
{
  "kind": "trivial" | "logic" | "io",
  "purpose": "string",
  "flow": ["string"],
  "uses": ["string"],
  "produces": ["string"],
  "watch": ["string"],
  "concepts": [
    { "name": "string", "briefExplainer": "string", "relevance": "string" }
  ]
}

## Input
Language: {{language}}
File: {{filename}}
Block label: {{label}}
Block difficulty (from segmenter): {{difficulty}}
Block lines {{startLine}}–{{endLine}}:
```{{language}}
{{blockCode}}
```

Surrounding file context (for reference; do NOT explain it):
```{{language}}
{{fileContext}}
```

{{additionalContext}}
```

- [ ] **Step 2: Update `explain` to pass `difficulty` into `loadPrompt`**

In `codewalk/src/engine/explanationAgent.ts`, find the `loadPrompt("explanation", { ... })` call around line 166. Add a `difficulty` key:

```ts
const prompt = await loadPrompt(
  "explanation",
  {
    language: guessLanguage(segment),
    filename: "(unknown)",
    label: segment.label,
    difficulty: segment.difficulty,          // NEW
    startLine: String(segment.startLine),
    endLine: String(segment.endLine),
    blockCode: segment.code,
    fileContext: fileContext,
    additionalContext: deps.additionalContext ? `Prior context:\n${deps.additionalContext}` : "",
  },
  deps.promptsDir,
);
```

- [ ] **Step 3: Update the prompt-loading test in `explanationAgent.test.ts`**

Find the `"prompt file exists and loads via prompt loader"` test (around line 14) and add `difficulty: "standard"` to the props object passed to `loadPrompt`. Extend the assertions to check that the rendered string includes the string `"standard"` somewhere (proving the variable substituted).

---

## Task 14: Eager trivial pre-population in `extension.ts`

**Files:**
- Modify: `codewalk/src/extension.ts`

Subscribe to `segmentStore.onDidChange(uri)` at activation and, for every trivial segment, synthesize + write to `explanationStore`. This runs regardless of the prefetch setting — synthesis is free.

- [ ] **Step 1: Add a subscription after `explanationStore` construction**

Find line 39 (`context.subscriptions.push(explanationStore);`). Immediately after it, add:

```ts
import { synthesizeTrivial } from "./engine/explanationAgent";
```
…at the top of the file near the other `./engine/explanationAgent` imports.

- [ ] **Step 2: Add the synthesis subscription**

After `context.subscriptions.push(explanationStore);`, insert:

```ts
// Eager trivial synthesis — every trivial-difficulty segment gets a zero-cost
// explanation written to the cache the moment segmentation finishes.
const trivialSub = store.onDidChange((uri) => {
  const segments = store.get(uri);
  if (!segments) return;
  for (const segment of segments) {
    if (segment.difficulty !== "trivial") continue;
    const existing = explanationStore.get(
      segment.id,
      currentPresetOrEmpty(),
      EXPLANATION_PROMPT_VERSION,
    );
    if (existing?.renderState === "done") continue;
    const exp = synthesizeTrivial(segment);
    explanationStore.set(
      segment.id,
      currentPresetOrEmpty(),
      EXPLANATION_PROMPT_VERSION,
      exp,
    );
  }
});
context.subscriptions.push(trivialSub);

function currentPresetOrEmpty(): string {
  // Uses the same closure that rebuildWiring populates; if the wiring hasn't
  // settled yet, fall back to an empty preset key so the entry is still cached
  // under the v2 prompt-version (it will rehydrate on any preset match).
  const cfg = vscode.workspace.getConfiguration("codewalk");
  return cfg.get<string>("backend") ?? "";
}
```

(Note: the `currentPresetOrEmpty` helper reads the backend preset directly from config because `rebuildWiring`'s `resolved.backend` lives inside a closure. Reading from config is correct for the synthesis path — the preset-component of the cache key is semantic, not tied to a specific adapter instance.)

- [ ] **Step 3: Verify compile**

Run: `cd codewalk && npm run compile-tests`
Expected: no errors.

- [ ] **Step 4: Write a smoke-test** (optional — if you can reach into `extension.ts` from tests; otherwise rely on manual verification)

Add a fast integration-style test under `codewalk/test/suite/` that creates a `SegmentStore`, fires `onDidChange`, and verifies the `ExplanationStore` has `kind: "trivial"` entries for trivial segments. Skip if the test harness doesn't give you easy access to module-private closures — the behavior is covered manually in Task 18's checklist.

---

## Task 15: Update `explanationLive.test.ts` assertions

**Files:**
- Modify: `codewalk/test/integration/explanationLive.test.ts`

- [ ] **Step 1: Replace v1 assertions with v2**

Locate the assertion block that checks `exp.summary`, `exp.pointsToConsider.*`, etc. Replace with:

```ts
assert.ok(exp.kind === "trivial" || exp.kind === "logic" || exp.kind === "io",
  `kind must be one of trivial|logic|io, got ${exp.kind}`);
assert.ok(typeof exp.purpose === "string" && exp.purpose.length > 0,
  "purpose must be a non-empty string");
assert.ok(Array.isArray(exp.flow));
assert.ok(Array.isArray(exp.uses));
assert.ok(Array.isArray(exp.produces));
assert.ok(Array.isArray(exp.watch));
assert.ok(Array.isArray(exp.concepts));
```

- [ ] **Step 2: Run (gated)**

This suite is gated by `CODEWALK_LIVE_EXPLANATION=1`. Don't run it in CI — just check the compile:

Run: `cd codewalk && npm run compile-tests`
Expected: no type errors.

---

## Task 16: Update `explanationEval.test.ts` fixture and scanner

**Files:**
- Modify: `codewalk/test/eval/explanationEval.test.ts`

- [ ] **Step 1: Extend `Fixture` type at line 12-22**

Replace with:
```ts
interface Fixture {
  name: string;
  segment: Segment;
  fileContext: string;
  expect: {
    expectedKind?: "trivial" | "logic" | "io";
    mustMention: string[];
    mustNotMention?: string[];
    minPurposeLength?: number;
    expectedConceptsIncluding?: string[];
  };
}
```

- [ ] **Step 2: Update the seed fixture at line 24-48**

Replace `expect:` block:
```ts
expect: {
  expectedKind: "io",
  mustMention: ["verif", "HS256"],
  mustNotMention: ["TODO", "FIXME", "I think"],
  minPurposeLength: 40,
  expectedConceptsIncluding: ["JWT"],
},
```

- [ ] **Step 3: Update the `allText` construction at line 86-90**

Replace:
```ts
const allText =
  exp.summary
  + " " + exp.pointsToConsider.assumptions.join(" ")
  + " " + exp.pointsToConsider.dangers.join(" ")
  + " " + exp.pointsToConsider.sideEffects.join(" ");
```

With:
```ts
const allText = [
  exp.purpose,
  exp.flow.join(" "),
  exp.uses.join(" "),
  exp.produces.join(" "),
  exp.watch.join(" "),
].join(" ");
```

- [ ] **Step 4: Update the console.log line at line 99-100**

Replace:
```ts
console.log(`       assumptions=${exp.pointsToConsider.assumptions.length} dangers=${exp.pointsToConsider.dangers.length} sideEffects=${exp.pointsToConsider.sideEffects.length} concepts=${exp.concepts.length}`);
```

With:
```ts
console.log(`       kind=${exp.kind} flow=${exp.flow.length} uses=${exp.uses.length} produces=${exp.produces.length} watch=${exp.watch.length} concepts=${exp.concepts.length}`);
if (fx.expect.expectedKind && exp.kind !== fx.expect.expectedKind) {
  console.warn(`       WARN expected kind=${fx.expect.expectedKind}, got ${exp.kind}`);
}
```

- [ ] **Step 5: Update the `minSummaryLength` check — rename to `minPurposeLength`**

Replace `const lenOk = (fx.expect.minSummaryLength ?? 0) <= exp.summary.length;` with `const lenOk = (fx.expect.minPurposeLength ?? 0) <= exp.purpose.length;`.

Update the subsequent warn line similarly.

- [ ] **Step 6: Verify compile**

Run: `cd codewalk && npm run compile-tests`
Expected: no errors.

---

## Task 17: Full build + test run — everything green

**Files:** None.

- [ ] **Step 1: Clean build**

Run: `cd codewalk && npm run build`
Expected: esbuild succeeds with no errors.

- [ ] **Step 2: Full test run**

Run: `cd codewalk && npm run pretest && npm test`
Expected: every suite passes. Count the tests — should be higher than pre-Task-1 baseline by ~6-8 new cases.

- [ ] **Step 3: Commit all the code changes as one feature commit**

```bash
git add codewalk/src/types/index.ts \
        codewalk/src/engine/explanationAgent.ts \
        codewalk/src/engine/explanationStore.ts \
        codewalk/src/engine/prefetchQueue.ts \
        codewalk/src/providers/commentController.ts \
        codewalk/src/extension.ts \
        codewalk/prompts/explanation.md \
        codewalk/test/suite/explanationAgent.test.ts \
        codewalk/test/suite/explanationStore.test.ts \
        codewalk/test/suite/commentController.test.ts \
        codewalk/test/suite/prefetchQueue.test.ts \
        codewalk/test/eval/explanationEval.test.ts \
        codewalk/test/integration/explanationLive.test.ts
git commit -m "phase2b: adaptive kind-aware explanation schema (v2) + trivial fast path"
```

---

## Task 18: Update `docs/PROJECT_STATE.md` with Phase 2b status + manual checklist

**Files:**
- Modify: `docs/PROJECT_STATE.md`

- [ ] **Step 1: Update the header**

Change the `Last updated:` line to today's date. Change the `Current step:` line to note "Phase 2b adaptive-explanation schema in place".

- [ ] **Step 2: Append under "Recent decisions"**

Add a line at the top of the Recent decisions list:

```
- **2026-04-20** — **Phase 2b — adaptive kind-aware explanation schema.** Replaced v1 `summary` + PTC arrays with a flat v2 schema: `kind ∈ {trivial, logic, io}` + `purpose` + `flow` + `uses` + `produces` + `watch` + `concepts`. Trivial-difficulty segments short-circuit the LLM (synthesized locally from `segment.oneLiner`) and are pre-populated into the cache at segmentation time. `EXPLANATION_PROMPT_VERSION` bumped v1 → v2; existing `ExplanationStore.rehydrate` sweep evicts v1 entries on first activation. See `docs/superpowers/specs/2026-04-20-codewalk-phase2b-adaptive-explanation.md` and plan in `docs/superpowers/plans/`.
```

- [ ] **Step 3: Append a new manual-checklist section**

After the existing "Phase 2 manual verification checklist" block, add:

```markdown
## Phase 2b manual verification checklist

### Adaptive output
- [ ] Open a file with imports at the top. Run `CodeWalk: Start Walkthrough`.
- [ ] After segmentation completes, click the imports-block CodeLens — panel opens INSTANTLY with one italic line. No spinner, no streaming.
- [ ] Click a mid-file logic block — panel shows a bold `purpose`, then `**Flow**`, `**Uses**`, `**Produces**`, `**Watch**` bullets.
- [ ] Click a small (3–5 line) non-trivial block — verify `Watch` has 0 or 1 items, not 3.
- [ ] Click an I/O block (fetch or DB call) — `uses` items name specific endpoints/tables/symbols.

### Runtime
- [ ] Trivial clicks: instant (< 50 ms perceived).
- [ ] Logic/io clicks: purpose arrives in ~1–2s, bullets within another ~2–3s. Overall ~3–5s per non-trivial click on Anthropic (down from ~20s in v1).

### Cache invalidation
- [ ] Before upgrade: open a file and click a non-trivial block; note the v1 entry lands in cache.
- [ ] Install v2. Reload window. Click the same block — it re-streams (v1 entry dropped on construction).
- [ ] `CodeWalk: Reset Explanation Cache` still works — clears v2 entries too.

### Kind normalization
- [ ] With debug logging on, verify `[explanation]` log lines include `kind=…` and `source=llm|synth` fields.
- [ ] If any log line starts with `[explanation] WARN trivial-kind returned populated arrays`, it means the model mis-tagged a rich block as trivial and the normalizer cleaned it up — acceptable.
```

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_STATE.md
git commit -m "phase2b/docs: Phase 2b decision + manual verification checklist"
```

---

## Self-Review Notes (applied inline during planning)

**Spec coverage check:**
- Spec §3.1.1 (new schema) — Tasks 2 + 3.
- Spec §3.1.2 (rewritten prompt) — Task 13.
- Spec §3.1.3 (trivial fast path) — Task 5.
- Spec §3.1.4 (eager pre-population) — Task 14.
- Spec §3.1.5 (kind-aware normalizer) — Task 6.
- Spec §3.1.6 (updated validation) — Task 6.
- Spec §3.1.7 (cache invalidation) — Task 1.
- Spec §3.1.8 (updated rendering) — Task 9.
- Spec §3.1.9 (diagnostics) — Task 6 (log-line rewrite) + Task 5 (synth log line).
- Spec §3.1.10 (updated eval rubric) — Task 16.
- Spec §3.1.11 (`additionalContext` seam preserved) — no task; preserved by Task 13's prompt keeping `{{additionalContext}}`.
- Spec §6 (prompt) — Task 13.
- Spec §7 (rendering) — Task 9.
- Spec §8 (validation mapping) — Task 6.
- Spec §9 (diagnostics) — Task 6 Step 5 + Task 5 Step 4.
- Spec §10 (eval) — Task 16.
- Spec §11 (cache) — Task 1 + Task 7.
- Spec §12 (interfaces) — Tasks 2–5.
- Spec §13 (testing) — Tasks 10–12, 15–16.

**Placeholder scan:** Every task body contains concrete file paths, concrete code, concrete commands. No "TBD", no "similar to", no "handle edge cases". The one "optional" step is Task 14 Step 4 (smoke-test for extension wiring) — flagged explicitly as conditional on test-harness access, with manual verification in Task 18 covering the behavior.

**Type consistency check:**
- `ExplanationKind` referenced as both a type (Task 2) and a union (Task 6); confirmed identical literal set in both places: `"trivial" | "logic" | "io"`.
- `extractPartialPurpose` defined in Task 4 and referenced in Task 9 Step 2 — name matches.
- `synthesizeTrivial(segment: Segment): Explanation` defined in Task 5 and imported in Task 14 — signature matches.
- `capAndFilter` defined in Task 6 — not referenced outside that file; local helper only. OK.
- Log line format in Task 6 Step 5 and Task 5 Step 4 uses the same field ordering (`segmentId`, `kind`, `purpose=Nch`, then counts, then `modelTimeMs`, `source`). Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-codewalk-phase2b-adaptive-explanation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
