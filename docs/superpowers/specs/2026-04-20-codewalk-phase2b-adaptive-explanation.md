# Phase 2b — Adaptive, Programmer-Oriented Explanations

**Date.** 2026-04-20
**Status.** Draft — awaiting user approval
**Scope.** A refinement of Phase 2's explanation agent. Not a new phase; a tightening pass on `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` driven by manual-verification findings.

**Related.**
- `CodeWalk-design-doc.md` §5 (UX flow) and §6 (Prompt Engineering Strategy).
- `docs/ARCHITECTURE_DECISIONS.md` ADR-005 — LLM-call validation contract. Every rule below ports to the new schema.
- `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` — the Phase 2 spec this refines.
- `docs/POST_MVP_VISION.md` — Phase 5 (Cross-file Intelligence). The `additionalContext` seam is preserved unchanged.

---

## 1. Motivation

Manual verification of Phase 2 surfaced three linked quality issues:

1. **Non-adaptive output.** A 3-line block and a 300-line block receive the same shape and roughly the same volume of explanation. 2-line blocks routinely receive 3 dangers, 3 assumptions, and 3 side-effects — the model pads toward the middle of the allowed `0–5` range regardless of whether the block warrants it.
2. **Wrong content density for the target audience.** The MVP audience is entry-level programmers. They reach for variable flow, "what kind of code is this" (networking, DB, validation), symbol dependencies, and expected outputs — not three-paragraph teaching-grade summaries. Current output reads like a textbook, not a code-reading cheat sheet.
3. **Latency.** Every click triggers an LLM call. On Anthropic (Claude Sonnet 4.6), this is ~20s end-to-end per block even for trivial ones. Output-token count dominates runtime; the padding from issue 1 directly causes the latency of issue 3.

All three issues trace to the same root cause: the Phase 2 prompt and schema do not adapt to the block's kind or size. This spec fixes that.

---

## 2. Goal

Replace the current summary + PTC + concepts schema with a **flat, shape-stable, kind-aware** schema that:

- Emits concise bullet-oriented output sized to the block.
- Classifies blocks into one of three kinds (`trivial`, `logic`, `io`) and adapts content per kind.
- Skips the LLM entirely for `trivial`-difficulty blocks (segmenter-seeded fast path).
- Pre-populates the explanation cache with trivial synthesis at segmentation time, so trivial blocks open instantly.
- Preserves the chunked streaming + elapsed-counter UX that Phase 2 already has working.

Non-goals for this pass: new UI, new navigation, cross-file references, Phase 4 line-by-line, Phase 5 symbol accumulator.

---

## 3. Scope

### 3.1 In scope

1. **New schema.** `Explanation` type gains a `kind` tag and replaces `summary` + `pointsToConsider` with a flat field set (`purpose`, `flow`, `uses`, `produces`, `watch`, `concepts`). See §4.
2. **Rewritten prompt.** `codewalk/prompts/explanation.md` rewritten around per-kind rules and bullet-oriented output. System/user split on `## Input` preserved.
3. **Trivial fast path.** When `segment.difficulty === "trivial"`, `explanationAgent.explain` short-circuits to local synthesis: `kind: "trivial"`, `purpose: segment.oneLiner`, all arrays empty. No LLM call, no streaming.
4. **Eager trivial pre-population.** At segmentation completion, every trivial-difficulty segment's synthesized explanation is written to `ExplanationStore` as `renderState: "done"`. First click on any trivial block is instant, even without prefetch enabled.
5. **Kind-aware normalizer.** Cross-item validation step normalizes output to match kind rules: trivial → arrays forced empty; non-trivial → per-array caps (`flow ≤ 5`, `uses ≤ 5`, `produces ≤ 3`, `watch ≤ 3`, `concepts ≤ 3`) enforced via truncation. Over-cap is logged but never fatal.
6. **Updated validation.** ADR-005 rules 2–4 ported to the new schema. Kind must be one of three valid values. `purpose` ≥ 20 chars and not equal to `segment.oneLiner`. Non-trivial blocks must have at least one of `flow`, `watch`, `concepts` non-empty (else retry).
7. **Cache invalidation.** `EXPLANATION_PROMPT_VERSION` bumped `"v1"` → `"v2"`. `ExplanationStore` construction sweep drops old v1 entries; no migration code.
8. **Updated rendering.** `CodeWalkCommentController`'s Markdown renderer replaced with a kind-aware layout (§7). Trivial blocks render as a single italic line. Non-trivial blocks render bullets under bold headers.
9. **Updated diagnostics.** Explanation logger line includes `kind` and `source=llm|synth`. Field count list updated for the new schema.
10. **Updated eval rubric.** `ExplanationFixture` gains optional `expectedKind`. `mustMention` now scans `purpose + flow + uses + produces + watch` joined (concepts unchanged). One hand-labeled fixture regenerated for v2.
11. **Preserved Phase 5 seam.** `ExplanationDeps.additionalContext?: string` remains; lands in the prompt's "Prior context" slot identical to v1. Always `undefined` in Phase 2b.

### 3.2 Out of scope

- Progressive per-field rendering during streaming (flow bullets appearing before uses, etc.). Phase 4 polish candidate.
- Character-by-character streaming. Current chunk-grain already feels typewriter-like for humans.
- New error types. Existing `SegmentTooLargeError`, `ExplanationStreamError`, `MalformedResponseError` cover all failure paths.
- New settings. Existing three (`prefetchOnSegmentation`, `streamIdleTimeoutMs`, `maxSegmentLines`) still apply.
- Cross-block references (symbols in `uses` becoming clickable). Phase 5 — the text mentions in `uses` become linkable later with zero schema change.
- Adding per-kind unions to the schema. A single flat shape with optional arrays is explicitly preferred over per-kind variants — keeps cache, rendering, and validation simple.
- A 4th+ kind (validation, control-flow, class, etc.). Explicitly kept at three for the first cut; split-out is a later refinement if output inspection reveals the need.

---

## 4. Schema

```ts
// src/engine/explanationAgent.ts (superseding the v1 Explanation type)

export interface Explanation {
  segmentId: string;                // content-hash from segmenter (unchanged)
  kind: "trivial" | "logic" | "io";
  purpose: string;                  // 1–2 sentences, always present, Markdown-safe plain text
  flow: string[];                   // 0–5 logical steps; empty for trivial
  uses: string[];                   // 0–5 symbols / modules / endpoints this block leans on
  produces: string[];               // 0–3 outputs or effects
  watch: string[];                  // 0–3 specific concerns (merged v1 assumptions + dangers + sideEffects)
  concepts: Concept[];              // 0–3; empty for trivial
  renderState: "streaming" | "done" | "error";
}

export interface Concept {         // unchanged from v1
  name: string;
  briefExplainer: string;
  relevance: string;
}
```

Corresponding JSON schema (`EXPLANATION_JSON_SCHEMA` constant, `strict: true`):

```json
{
  "name": "codewalk_explanation",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "kind": { "type": "string", "enum": ["trivial", "logic", "io"] },
      "purpose": { "type": "string" },
      "flow": { "type": "array", "items": { "type": "string" } },
      "uses": { "type": "array", "items": { "type": "string" } },
      "produces": { "type": "array", "items": { "type": "string" } },
      "watch": { "type": "array", "items": { "type": "string" } },
      "concepts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "briefExplainer": { "type": "string" },
            "relevance": { "type": "string" }
          },
          "required": ["name", "briefExplainer", "relevance"],
          "additionalProperties": false
        }
      }
    },
    "required": ["kind", "purpose", "flow", "uses", "produces", "watch", "concepts"],
    "additionalProperties": false
  }
}
```

All arrays `required` (may be empty `[]`). `strict: true` holds for Anthropic's `json_schema` path; the same schema is described textually in the system prompt for the `json_object` path (Groq, Ollama).

---

## 5. Fast path — trivial synthesis

### 5.1 Synthesis rule

When `segment.difficulty === "trivial"`, the explanation is synthesized locally without an LLM call:

```ts
function synthesizeTrivial(segment: Segment): Explanation {
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

Time: O(1). Cost: zero. No network, no adapter, no streaming.

### 5.2 Eager pre-population

The trivial synthesis runs at segmentation completion time, not at click time:

1. `segmenter.segment(doc)` completes for a URI.
2. In `extension.ts`'s segmentation wiring, immediately after `segmentStore.set(uri, segments)`:
   - For each `segment` in `segments` where `segment.difficulty === "trivial"`:
     - Synthesize the explanation.
     - Write to `explanationStore` with `preset` and `EXPLANATION_PROMPT_VERSION` — same key format as any `done` entry.
3. Persisted to `globalState` via the existing `done`-state persistence path.

This runs regardless of `codewalk.explanation.prefetchOnSegmentation` — trivial pre-population is free and strictly user-beneficial.

### 5.3 Mis-classification handling

If the segmenter tags a non-trivial block as trivial, the user will see a thin one-line explanation. This is a segmenter bug, not an explanation bug. Mitigation paths:

- Manual: `codewalk.resetExplanationCache` clears the entry; next click falls through to the LLM path after the segmenter's next run re-tags the block.
- Automatic: none. The segmenter is the authority on difficulty.

Acceptable trade. Wrong-direction errors (LLM-explained block that should have been trivial) are benign — the user just gets richer output than strictly necessary.

### 5.4 Diagnostic

Every synth emits a log line:
```
[explanation] segmentId=seg-ab12 kind=trivial purpose=74ch modelTimeMs=0 source=synth
```

---

## 6. Prompt — `codewalk/prompts/explanation.md`

System half (loaded before `## Input` marker):

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
```

User half (after `## Input`):

```
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

Notes:
- `{{difficulty}}` is new (it's the segmenter's tag — `trivial` / `standard` / `complex` / `critical`). Serves as a weak hint; the model makes the final kind call.
- `{{additionalContext}}` slot preserved; always empty in Phase 2b.
- `{{fileContext}}` elision for empty-context callers preserved from Phase 2.

Retry-path system-half augmentation unchanged from Phase 2:
```
CRITICAL: your previous response failed validation: <specific reason>. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.
```

---

## 7. Rendering (CommentController Markdown)

### 7.1 Trivial layout

Single italic line, nothing else:

```markdown
_{purpose}_
```

No "CodeWalk" header block, no sections, no Concepts details. Keeps trivial-block panels visually distinct from logic/io panels — the density difference is itself UX signal.

### 7.2 Logic / io layout

```markdown
**{purpose}**

**Flow**
- {flow[0]}
- {flow[1]}
- {flow[2]}

**Uses** · `{uses[0]}` · `{uses[1]}` · `{uses[2]}`

**Produces** · {produces[0]} · {produces[1]}

**Watch**
- {watch[0]}

<details><summary>Concepts ({concepts.length})</summary>

**{concepts[0].name}** — {concepts[0].briefExplainer}
_{concepts[0].relevance}_

**{concepts[1].name}** — …

</details>
```

Omissions:
- `Uses`, `Produces`, `Watch`, `Concepts` headers are emitted only if the underlying array is non-empty.
- `Flow` header is always emitted for logic/io because `flow` is guaranteed non-empty by validation (§8 cross-item rule).
- Empty `Concepts` → `<details>` block omitted entirely.

Backticks on `uses` items give the symbols a code-ish visual weight without markdown-parsing risk (if a user's symbol contains a backtick, the renderer escapes it upstream).

### 7.3 Streaming layout

For logic/io blocks during streaming (pre-stream-end):
- Phase 1: `purpose` streams in chunks. Panel shows the partial `purpose` as it arrives (no surrounding headers yet).
- Phase 2: once `purpose` closes (detected by the streaming regex), panel switches to `**{purpose}**\n\n_Analyzing… {elapsed}s_` with a 500ms `.` / `..` / `...` dot animation on the "Analyzing" label.
- Phase 3: at stream end (full JSON parsed + validated), panel swaps to the final §7.2 layout atomically.

Trivial blocks skip all three phases — they render at §7.1 immediately on click.

### 7.4 Streaming extractor

Regex extraction of the `purpose` field during streaming uses a rename of the existing `SUMMARY_RE`:

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

Zero structural change from v1 — just a rename to match the new field.

---

## 8. Validation (ADR-005 mapping)

| Rule | New-schema implementation |
|---|---|
| 1. Input guard | `SegmentTooLargeError` when `lineCount > maxSegmentLines` (unchanged). Additional: if `segment.difficulty === "trivial"`, synthesis fast path — return without parse/validate machinery. |
| 2. Parse | `JSON.parse(raw)` → `RawExplanation`. On exception: `ValidationFailure("response is not valid JSON")`. |
| 3. Per-item validation | <ul><li>`kind` must be one of `{"trivial", "logic", "io"}`. Invalid → `ValidationFailure("kind is missing or invalid")`.</li><li>`purpose` must be string, ≥ 20 chars, not equal (case-insensitive trimmed) to `segment.oneLiner`.</li><li>Each string item in `flow`, `uses`, `produces`, `watch` must be ≥ 15 chars and fail the generic-phrase regex (reused from v1). Items failing per-item are **dropped** (non-fatal), counted as `droppedCount` for diagnostics.</li><li>Each `Concept` requires `name`, `briefExplainer`, `relevance` all non-empty strings. Failing concepts dropped.</li></ul> |
| 4. Cross-item validation | <ul><li>**Kind normalization:** if `kind === "trivial"` and any array (`flow`, `uses`, `produces`, `watch`, `concepts`) has items, force them to `[]` and log a warning. Never fatal.</li><li>**Non-trivial completeness:** if `kind ∈ {"logic", "io"}` and `flow.length === 0` AND `watch.length === 0` AND `concepts.length === 0` → `ValidationFailure("non-trivial block emitted no flow/watch/concepts")`.</li><li>**Dedup:** `concepts[].name` deduped by lowercase-trimmed first-occurrence.</li><li>**Caps:** `flow` → max 5, `uses` → max 5, `produces` → max 3, `watch` → max 3, `concepts` → max 3. Over-cap → truncate silently, log warning. Never fatal.</li></ul> |
| 5. Retry | Single retry with threaded reason (unchanged machinery). System half gets `CRITICAL:` suffix. User half unchanged. On retry failure: `MalformedResponseError` with both raw responses. |
| 6. Diagnostics | See §9. |
| 7. Eval | See §10. |
| Addendum — Cancellation | Unchanged. `CompleteOptions.signal` from `toAbortSignal(deps.token)`; stream iteration checks between chunks; synchronous `throwIfCancelled` before first attempt and before retry. |
| Addendum — Content-hash ids | Unchanged. `segmentId` is segmenter-issued content hash. Cache key `explanation:${preset}:${promptVersion}:${segmentId}` gives natural invalidation on code change. Prompt change handled by `promptVersion` bump. |

---

## 9. Diagnostics

### 9.1 Logger line format

Per successful call:

**LLM path (logic, io):**
```
[explanation] segmentId=seg-ab12 kind=logic purpose=180ch flow=3 uses=2 produces=1 watch=1 concepts=2 modelTimeMs=2340 retryFired=false source=llm
```

**Synth path (trivial):**
```
[explanation] segmentId=seg-cd34 kind=trivial purpose=74ch modelTimeMs=0 source=synth
```

**WARN prefix** when:
- Retry fired.
- Any per-item validation dropped items.
- Any array over-cap truncation occurred.
- Kind normalization zeroed non-trivial arrays on a trivial-kind response.

### 9.2 Diagnostic fields never logged

Raw prompt, raw block code, raw model response — unchanged from v1. Privacy/PII contract intact.

---

## 10. Eval harness

### 10.1 Fixture shape

```ts
interface ExplanationFixture {
  name: string;
  segment: Segment;
  fileContext: string;
  expect: {
    expectedKind?: "trivial" | "logic" | "io";       // soft warning on mismatch
    mustMention: string[];                            // hard pass/fail — strings that MUST appear in purpose + flow + uses + produces + watch (joined, case-insensitive)
    mustNotMention?: string[];                        // soft warning
    minPurposeLength?: number;                        // soft warning
    expectedConceptsIncluding?: string[];             // soft warning — case-insensitive concept-name match
  };
}
```

### 10.2 Runner output

```
[eval] jwt-block kind=io expectedKind=io PASS
       purpose=203ch mustMention=["verify","users","jwt.verify"] PASS
       flow=4 uses=3 produces=2 watch=2 concepts=2
       expectedConceptsIncluding=["JWT"] PASS
       retryFired=false modelTimeMs=2341 source=llm
```

### 10.3 Fixture migration

The v1 `mustMention` field was scanning `summary + pointsToConsider.{assumptions, dangers, sideEffects}.join(" ")`. The v2 scan is `purpose + flow + uses + produces + watch` joined. The existing JWT-block fixture's expected strings remain accurate (the content should still appear; just in different fields).

Per ADR-005 §7 — eval is a trend signal, not a CI gate. `EVAL_EXPLANATION=1` still gates invocation.

---

## 11. Cache invalidation

- Bump `EXPLANATION_PROMPT_VERSION` constant from `"v1"` → `"v2"` in `src/engine/explanationAgent.ts`.
- `ExplanationStore` construction sweep (existing code) enumerates all `explanation:*` keys in `globalState` and drops entries where `promptVersion !== EXPLANATION_PROMPT_VERSION`. v1 entries die on next extension activation.
- No migration code. v1 data is incompatible with v2 schema; cleanest path is eviction.
- User-facing: any previously-cached explanation re-fetches on first click after upgrade. Expected. `codewalk.resetExplanationCache` command still available for manual clear.

---

## 12. Public interfaces

### 12.1 `explanationAgent.ts` (changes)

```ts
// Schema constants
export const EXPLANATION_PROMPT_VERSION = "v2";           // was "v1"
export const EXPLANATION_JSON_SCHEMA: JsonSchemaSpec = { /* §4 */ };

// Streaming extractor (renamed)
export function extractPartialPurpose(buffer: string): string | undefined;

// Explanation type (superseding v1)
export interface Explanation { /* §4 */ }
export interface Concept { /* §4 */ }

// Synthesis fast path (new)
export function synthesizeTrivial(segment: Segment): Explanation;

// Main entry point — signature unchanged
export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation>;
```

`explain` internally short-circuits on `segment.difficulty === "trivial"` by calling `synthesizeTrivial` before prompt construction. External callers see identical behavior (Promise<Explanation>, still `done`, still cacheable) — the fast path is an implementation detail.

### 12.2 `extension.ts` (changes)

Segmentation completion wiring gains a trivial-synthesis pre-population step:

```ts
// (pseudocode; exact placement in the plan)
segmentStore.set(uri, segments);
for (const segment of segments) {
  if (segment.difficulty === "trivial") {
    const exp = synthesizeTrivial(segment);
    explanationStore.set(segment.id, preset, EXPLANATION_PROMPT_VERSION, exp);
  }
}
```

No new module. No new disposable. Additive.

### 12.3 `commentController.ts` (changes)

`renderMarkdown(exp: Explanation): string` is rewritten to the §7 layout. Streaming intermediate states (§7.3) replace the v1 `summary`-based progressive renderer. Public surface of `CodeWalkCommentController` unchanged.

### 12.4 Callers / consumers unchanged

- `PrefetchQueue` — still calls `explain(segment, fileContext, deps)`. Now skips trivial blocks automatically because they're already in the cache after segmentation.
- `ExplanationStore` — storage format is opaque-JSON per key; new schema flows through without changes to the store itself.
- `startWalkthrough.ts` error cascade — no new typed errors, no cascade changes.
- `LLMAdapter` / `OpenAICompatibleAdapter` — no changes.
- `SegmentStore` / `segmenter.ts` — no changes.

---

## 13. Testing

### 13.1 Unit tests (updated / new)

**`explanationAgent.test.ts`** — revised suites:

- **Synthesis fast path** (new):
  - `synthesizeTrivial returns kind=trivial with purpose=segment.oneLiner`.
  - `explain short-circuits on difficulty="trivial" — no adapter call made`.
  - `synthesis result includes renderState="done"`.
  - `synthesis result has all arrays empty`.
- **Kind-aware validation**:
  - `invalid kind value raises ValidationFailure`.
  - `kind="trivial" with non-empty arrays triggers normalization — arrays forced to []`.
  - `kind="logic" with empty flow AND empty watch AND empty concepts raises ValidationFailure`.
  - `kind="io" with only flow populated passes validation`.
- **Caps & truncation**:
  - `flow over 5 items truncates to 5, logs warning, does not retry`.
  - `concepts over 3 items truncates to 3`.
- **Per-item validation**:
  - `purpose < 20 chars raises ValidationFailure`.
  - `purpose equal (trimmed, lowercased) to oneLiner raises ValidationFailure`.
  - `generic-phrase items in watch are dropped`.
  - `concepts with empty briefExplainer are dropped`.
- **Retry**:
  - `validation failure on attempt 0 triggers retry with CRITICAL suffix including specific reason`.
  - `double validation failure raises MalformedResponseError with both raws`.
- **Streaming**:
  - `onPartial fires with partial purpose as tokens arrive`.
  - `onPartial does not fire with invalid partial JSON`.
  - `extractPartialPurpose handles the renamed field`.
- **Cancellation**: unchanged from v1 coverage.
- **Diagnostics**:
  - `logger line includes kind, field counts, source=llm`.
  - `synth path logger line includes source=synth and modelTimeMs=0`.
- **additionalContext hook**: `passes string into prompt when provided` — unchanged from v1.

**`explanationStore.test.ts`** — minimal changes:
- `construction drops entries where promptVersion differs from EXPLANATION_PROMPT_VERSION` — already tested; add a specific v1→v2 case.
- `set / get round-trip preserves kind and all new fields` — schema change needs new round-trip coverage.

**`commentController.test.ts`** — updated for new rendering:
- `trivial-kind explanation renders as single italic line`.
- `logic-kind explanation renders purpose, flow, uses, produces, watch with proper headers`.
- `io-kind explanation renders with specific-symbol uses formatting`.
- `concepts details block renders only when concepts non-empty`.
- `empty-arrays suppress their section headers`.
- Streaming-phase tests updated for §7.3 layout transitions.

**`prefetchQueue.test.ts`** — add:
- `trivial-difficulty segments are skipped (already in cache from pre-population)`.

### 13.2 Eval harness

- `test/eval/explanationEval.test.ts` fixture updated per §10.
- One golden fixture regenerated against v2.
- Gated `EVAL_EXPLANATION=1`. Still not a CI gate.

### 13.3 Live integration test

`test/integration/explanationLive.test.ts` — gated `CODEWALK_LIVE_EXPLANATION=1`. Updated assertions:
- Top-level object has required fields: `kind`, `purpose`, `flow`, `uses`, `produces`, `watch`, `concepts`.
- `kind ∈ {trivial, logic, io}`.
- `purpose` is non-empty string.

### 13.4 Manual verification checklist (appended to `docs/PROJECT_STATE.md`)

- **Trivial-block instant render.** Open a file with imports or config at the top. Segmentation completes. Click the top CodeLens (it should be tagged `trivial` difficulty). Panel opens instantly with a single italic line. No spinner, no streaming animation.
- **Logic-block adaptive output.** Click a mid-file logic block. Panel shows `purpose` streaming in chunks, then bullets under `Flow`, `Uses`, `Produces`, `Watch` headers.
- **Watch is sized to the block.** Click a 2–3 line block that's non-trivial. Verify `Watch` is 0–1 items, not 3.
- **Output feels like bullets, not paragraphs.** The opened panel should visually read as "skim me" rather than "read me".
- **Runtime feel.** Trivial clicks: instant. Logic/io clicks: purpose arrives in ~1–2s, bullets within another ~2–3s. Overall ~3–5s per non-trivial click on Anthropic.
- **v1 cache evicted.** Before installing v2, open a file and click a block. After installing v2, reload window. Click the same block — it re-streams (v1 entry dropped).
- **Prompt-version bump re-invalidates.** Bump `EXPLANATION_PROMPT_VERSION` to `"v3"` locally, reload — the v2 entry is evicted on construction.
- **Kind-normalization catch.** Deliberately force the LLM to return `kind:"trivial"` with populated arrays (edit a test double) — verify the normalizer empties them and logs a warning.

---

## 14. Risks

### 14.1 LLM mis-classifies logic vs io
The split is fuzzy (a JWT handler does both). Mitigation: the rendering differs only by which items go in `uses` (io should name specific endpoints/tables). Mis-classification produces worse-focused but not broken output. No retry on kind mismatch.

### 14.2 Segmenter mis-tags non-trivial as trivial
Block gets thin one-line explanation forever. Mitigation: `codewalk.resetExplanationCache` + segmenter prompt fix. Acceptable rare-case trade.

### 14.3 Non-trivial completeness rule over-triggers
If a block is genuinely simple (e.g., a one-line pure function that's still non-trivial), the LLM might legitimately emit empty arrays. The completeness rule would then fire a retry. Mitigation: the rule requires ALL of `flow`, `watch`, `concepts` to be empty — if even one has a single item, the block passes. Real simple-but-non-trivial blocks will almost always have at least one `flow` step.

### 14.4 Output shape churn
The rendering layout is opinionated. If output inspection reveals that bullets-with-middle-dots (`Uses · a · b · c`) reads worse than a vertical list, the renderer can be adjusted without schema changes.

### 14.5 Schema drift between Anthropic (`json_schema`) and everyone else (`json_object`)
`strict: true` on Anthropic guarantees the schema; `json_object` providers follow the system-prompt description. If a provider drifts (extra fields, wrong types), validation catches it and retries. Same pattern as v1.

---

## 15. Demo target

1. Open `codewalk/test/fixtures/sample.ts`. Run `CodeWalk: Start Walkthrough`.
2. Segmentation completes. The import block at the top of the file is tagged `trivial` by the segmenter. Its explanation is synthesized at segmentation time — no click yet.
3. Click the import-block CodeLens → panel opens instantly showing a single italic line. No spinner, no streaming.
4. Click the main business-logic block → panel shows `purpose` streaming in 1–2 chunks over ~1–2s, then `**Flow**`, `**Uses**`, `**Produces**`, `**Watch**` bullets appear together after ~2–3 more seconds. Total perceived time: ~3–5s. Output fits on one screen. Reads like a cheat sheet, not a textbook.
5. Click an I/O block (fetch or DB call) → panel shows `uses` items naming the specific endpoint/table, `watch` items naming specific failure modes.
6. Click a small validation block (3–5 lines) → `watch` has 0 or 1 items, not 3. No filler.
7. Reload window. Click the import block → instant (persisted synth). Click the logic block → instant (persisted llm `done`).

---

## 16. Future work

- **Progressive field rendering** (each field reveals as it arrives in the JSON stream, rather than `purpose` then everything-else). Phase 4 polish if demand shows up.
- **Cross-block `uses` references.** `uses` items become clickable links jumping to the defining block. Zero schema change; Phase 5 work on the walk-trail UX.
- **Per-kind rendering tuning.** If output inspection reveals logic and io warrant different layouts, split the renderer. Stays inside `commentController.ts`.
- **4th kind.** If `validation`, `control-flow`, or `class` emerge as distinct-enough categories from real output, split them out. Requires schema change + cache invalidation + prompt update. Not before Phase 4.
- **Adaptive runtime budget.** Measure per-kind `modelTimeMs` over a week of dogfooding; tune caps if one kind consistently overruns.
