# Phase 2 — Level 1 Explanations

**Date.** 2026-04-20
**Status.** Draft — awaiting user approval
**Scope.** One phase of the MVP. See `docs/IMPLEMENTATION_PLAN.md` for where Phase 2 sits in the full arc.
**Related.**
- `CodeWalk-design-doc.md` §4 (master spec — Level 1 panel description).
- `docs/ARCHITECTURE_DECISIONS.md` — ADR-001 (unified adapter), ADR-002 (externalized prompts), ADR-005 (LLM-call validation contract, canonical form of the pipeline Phase 2 must mirror).
- `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md` (dependencies — segment store, CodeLens wiring, `expandBlock` stub).
- `docs/POST_MVP_VISION.md` — Phase 5 (Cross-file Intelligence) design that Phase 2 preserves a hook for.

---

## 1. Goal

Clicking a `▶ {label} — {oneLiner}` CodeLens expands an inline explanation panel attached to the block's range. The panel contains a summary paragraph, Points to Consider (assumptions, dangers, side effects), and tagged concepts in a collapsible section. A second LLM agent (prompt `explanation.md`) generates the content. Only one panel is open at a time — expanding a new block collapses the previously open one; re-clicking the open block collapses it.

The explanation streams into the panel character-by-character for the `summary` field. Explanations are cached in VS Code's `globalState` so subsequent clicks and window reloads are instant and cost-free. An opt-in prefetch mode fills the cache in the background immediately after segmentation completes.

---

## 2. Scope

### 2.1 In scope

1. **`ExplanationAgent`.** New module at `src/engine/explanationAgent.ts`. Implements the ADR-005 seven-rule pipeline for structured-output LLM calls. Input: one `Segment` plus `fileContext` (full file with the block marked). Output: an `Explanation` record per §6.2.
2. **`prompts/explanation.md`.** New prompt file, loaded via the existing ADR-002 loader. System/user role split on the `## Input` marker (same trick as `segmentation.md`, required for Anthropic's OpenAI-compat endpoint). Produces a single JSON object matching the `Explanation` schema.
3. **`ExplanationStore`.** New module at `src/engine/explanationStore.ts`. Cache backed by `ExtensionContext.globalState`. Key format: `${preset}:${promptVersion}:${segmentId}`. In-memory `Map` mirror for fast reads plus partial-state during streaming. Fires `onDidChange(segmentId)` on every write so subscribed panels can re-render.
4. **`CodeWalkCommentController`.** New module at `src/providers/commentController.ts`. Owns a single `vscode.CommentController`, tracks `openThread: CommentThread | undefined`, and implements the expand/collapse/toggle behavior. Subscribes to `SegmentStore.onDidChange` as the third listener alongside the Phase 1 lens provider and block highlighter.
5. **Streaming support on `LLMAdapter`.** `OpenAICompatibleAdapter` gains a streaming code path. Existing non-streaming `complete` stays for the segmenter; new `completeStream` (or a streaming variant on `CompleteOptions` — exact surface decided in the plan) emits `AsyncIterable<string>` of raw text chunks. Server-Sent-Events (`text/event-stream`) supported by every provider CodeWalk targets.
6. **Partial-update hook.** `ExplanationDeps.onPartial` fires during streaming. A tolerant regex extracts the `summary` field from the still-incomplete JSON buffer and pushes it into the store as `{renderState: "streaming", summary: partial}`. `pointsToConsider` and `concepts` render at stream end only.
7. **Prefetch queue.** New module at `src/engine/prefetchQueue.ts`. Opt-in via `codewalk.explanation.prefetchOnSegmentation` (default `false`). Subscribes to `SegmentStore.onDidChange`. Runs `explanationAgent.explain` with concurrency 2. Silent on errors (logged at `[prefetch]` but no toasts). Auth failures disable the queue for the remainder of the session.
8. **`codewalk.expandBlock` command body.** Replaces the Phase 1 no-op stub. Resolves `segmentId` via `SegmentStore`, calls `commentController.expand(segment)`. Callsites from the CodeLens provider unchanged.
9. **Eval harness.** `test/eval/explanationEval.test.ts`, gated by `EVAL_EXPLANATION=1`. One hand-labeled golden fixture in Phase 2. Rubric: `mustMention` misses fail; `mustNotMention`, `minSummaryLength`, and `expectedConceptsIncluding` print as warnings. Per ADR-005 §7 — trend signal, not CI gate.
10. **Settings additions.**
    - `codewalk.explanation.prefetchOnSegmentation: boolean` (default `false`).
    - `codewalk.explanation.streamIdleTimeoutMs: number` (default `60000`).
    - `codewalk.explanation.maxSegmentLines: number` (default `400`).
11. **Error handling.** Two new typed errors exported from `src/engine/explanationAgent.ts` — `SegmentTooLargeError` and `ExplanationStreamError`. Both threaded into `startWalkthrough.ts`'s `handleError` cascade with dedicated user-facing messages.
12. **Reset-cache command.** `codewalk.resetExplanationCache` — clears every `explanation:*` key from `globalState`. Mirrors the `codewalk.resetApiKey` pattern. Useful for prompt iteration and debugging.
13. **Phase 5 seam.** `ExplanationDeps.additionalContext?: string` field on the agent interface, wired into the prompt template as an optional `Prior context:` block. Always `undefined` in Phase 2. Sole concession to the `POST_MVP_VISION.md` Phase 5 (Cross-file Intelligence) design; no other Phase 2 surface changes for Phase 5 readiness.

### 2.2 Out of scope (deferred to later phases)

- Line-by-line annotations (`after.contentText`) — Phase 4.
- `HoverProvider` for per-line detail — Phase 4.
- Difficulty color coding on CodeLens labels themselves — Phase 4.
- Sidebar file picker and file queue — Phase 3.
- Keyboard shortcuts (`Alt+↓`/`Alt+↑`/`Alt+S`) — Phase 3.
- Auto-expand of the first block after segmentation — design-doc §5.3 mentions a setting for this; deferred because it interacts awkwardly with prefetch-off (forces a 3s wait the user didn't ask for). Revisit Phase 4.
- Cross-file / repo-aware explanations — Phase 5+ per `POST_MVP_VISION.md`. Phase 2 preserves one hook (`additionalContext?: string` on `ExplanationDeps`) so Phase 5 plugs in without refactor.
- Anthropic prompt caching via an adapter escape hatch — deferred. Known follow-up; acceptable latency hit for Phase 2.
- Streaming segmentation — Phase 1's single-shot segmentation is unchanged.
- Webview-based explanation rendering — rejected. `CommentController` renders Markdown natively in `Comment.body`; no webview bundle, no theme management.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                          │
│                                                                        │
│   CodeLens click ─▶ codewalk.expandBlock(segmentId)                    │
│                            │                                           │
│                            ▼                                           │
│                 ┌──────────────────────────┐                           │
│                 │ CodeWalkCommentController │                          │
│                 │   - openThread state      │                          │
│                 │   - expand(segmentId)     │                          │
│                 └──────┬─────────┬──────────┘                          │
│                        │         │                                     │
│           cache miss   │         │   cache hit                         │
│                        ▼         ▼                                     │
│           ┌─────────────────────────────────┐                          │
│           │        ExplanationStore          │                         │
│           │  (in-memory Map + globalState)   │                         │
│           │  key: preset:promptVer:segmentId │                         │
│           └──────┬──────────────────────────┘                          │
│                  │                                                     │
│                  ▼                                                     │
│           ┌────────────────────────┐                                   │
│           │   ExplanationAgent     │                                   │
│           │   (ADR-005 pipeline)   │                                   │
│           │  - prompt.md loader    │                                   │
│           │  - validation + retry  │                                   │
│           │  - streaming onPartial │                                   │
│           └──────┬────────────────┘                                    │
│                  │                                                     │
│                  ▼                                                     │
│           ┌────────────────────────────┐                               │
│           │   LLMAdapter (streaming)    │                              │
│           │   completeStream(...)       │                              │
│           └────────────────────────────┘                               │
│                                                                        │
│   SegmentStore.onDidChange(uri) ───▶ (optional) PrefetchQueue          │
│                                         │                              │
│                                         └─▶ ExplanationAgent           │
│                                                (silent on failure)     │
└────────────────────────────────────────────────────────────────────────┘
```

**Wiring at activation** (`src/extension.ts` changes):

1. `explanationStore` constructed before `commentController`, injected into it.
2. `commentController` subscribes to `segmentStore.onDidChange(uri)` as the third listener (after `codeLensProvider` and `blockHighlighter`).
3. `codewalk.expandBlock` command body swapped from no-op to `commentController.expand(segmentId)`.
4. If `codewalk.explanation.prefetchOnSegmentation === true`, `prefetchQueue` also subscribes to `segmentStore.onDidChange`.
5. All new disposables pushed into `context.subscriptions`.

No changes to `codeLensProvider.ts`, `blockHighlighter.ts`, `segmentStore.ts`, `segmenter.ts`, or `firstRunWizard.ts`.

---

## 4. Data flow

### 4.1 Flow A — first click on a segment (cache miss, prefetch off)

1. User clicks `▶ JWT Validation — …`.
2. CodeLens fires `codewalk.expandBlock(segmentId)`.
3. `commentController.expand(segmentId)`:
   a. `explanationStore.get(segmentId, preset, promptVersion)` → `undefined`.
   b. Collapse `openThread` if any (dispose + clear reference).
   c. Create a new `CommentThread` at the segment's line range. Initial body: `Analyzing…`. Set as `openThread`.
   d. Write placeholder entry `{renderState: "streaming", summary: ""}` to the store.
4. `explanationAgent.explain(segment, fileContext, {adapter, onPartial, token, additionalContext: undefined})`:
   a. Input guard — reject segments > `maxSegmentLines` with `SegmentTooLargeError`.
   b. `adapter.completeStream(...)` yields text chunks.
   c. For every chunk, `onPartial` applies the tolerant `summary`-field regex to the accumulated buffer. If the regex matches, the store is updated with `{renderState: "streaming", summary: partial}`. `commentController` subscribes to `store.onDidChange(segmentId)` and re-renders the open thread's comment body.
   d. Stream ends. Run ADR-005 §2–4 on the full buffer: parse → per-item validate → cross-item validate.
   e. On validation failure, ADR-005 §5 retry with the specific reason threaded into the system prompt. Retry is a single call, non-streaming on the retry (no need to animate a retry — the user already saw the first attempt).
   f. Final `Explanation` record written to the store with `{renderState: "done"}`.
5. `commentController` re-renders the thread body with summary + Points to Consider + `<details>` Concepts section.

### 4.2 Flow B — cache hit

1. User clicks `▶ JWT Validation — …`.
2. CodeLens fires `codewalk.expandBlock(segmentId)`.
3. `commentController.expand(segmentId)`:
   a. `explanationStore.get(segmentId, preset, promptVersion)` → `{renderState: "done", ...}`.
   b. Collapse `openThread` if any.
   c. Create a new `CommentThread`. Render full Markdown immediately. Set as `openThread`.
4. No LLM call. No streaming animation.

Cache hits include:
- Previous clicks in the same session.
- Previous clicks from a prior session (`globalState`-persisted).
- Prefetched entries from the current session.

### 4.3 Flow C — prefetch (setting on)

1. `segmentStore.onDidChange(uri)` fires (segmentation completed for `uri`).
2. `prefetchQueue.enqueueAll(segments for uri)`.
3. Queue runs with concurrency 2. For each segment:
   a. If the store already has a `done` entry, skip.
   b. If a `streaming` entry exists (user already clicked it), skip.
   c. Write a `streaming` placeholder.
   d. Call `explanationAgent.explain(segment, {token: queueToken, ...})`.
   e. On success, store update fires `onDidChange(segmentId)` — which does nothing unless a thread for that segment is open (it wouldn't be; user hasn't clicked it yet).
   f. On failure, log `[prefetch] error segmentId=… reason=…` and leave the store untouched.
4. `segmentStore.onDidChange(uri)` fires again (file edited, re-segmentation):
   a. Queue cancels `queueToken`. In-flight requests abort via the ADR-005 cancellation chain.
   b. Queue reconstructs a fresh token and enqueues the new segment list.
   c. Orphaned prefetches for old segment ids die on cancellation; their placeholder entries are left in the cache (the stale ids will never be queried again, and `promptVersion` bumps will eventually sweep them).
5. If any prefetch call raises `AuthError`, the queue disables itself for the session. Log `[prefetch] disabled: auth failed`.

### 4.4 Flow D — user clicks a second block mid-stream

1. Thread A is open, streaming. User clicks block B.
2. `commentController.expand(segmentB)`:
   a. Cancel the in-flight agent call for block A (via its per-segment `CancellationTokenSource`).
   b. Dispose thread A. Clear `openThread`.
   c. Proceed with Flow A or B for block B.
3. The cancelled call for block A does NOT write to the store. The partial entry is left as-is; any subsequent click on block A starts fresh.

---

## 5. UX behaviors (pinned)

### 5.1 "Only one panel open at a time"

- Expanding a new block disposes the previously open thread. The `CommentController` tracks `openThread: CommentThread | undefined`; `expand(segmentId)` disposes it before creating a new one.
- Re-clicking the currently open block's CodeLens is a toggle — the thread disposes, `openThread` becomes `undefined`, no new thread is created.
- Switching to a different editor does NOT collapse the thread. `CommentController` is document-agnostic; threads are tied to `Uri`, not editor focus.

### 5.2 Streaming vs cache-hit rendering

- Fresh fetch: the panel opens with "Analyzing…" and streams the summary paragraph. Points to Consider and Concepts render all-at-once at stream end because partial lists look broken mid-stream.
- Cache hit: the panel opens with the full rendered Markdown immediately. No streaming replay, no animation.

### 5.3 Concepts rendering

- Rendered as an HTML `<details>` block inside the Markdown: `<details><summary>Concepts (N)</summary> ... </details>`. VS Code's `CommentController` renders `<details>` natively. Default collapsed.
- Each concept is listed as `**<name>** — <briefExplainer>` followed by a short italicized `<relevance>` line.
- `<details>` state does not persist across collapse/reopen — a re-expanded thread starts with Concepts collapsed again. Acceptable; this is the Markdown rendering default.

### 5.4 First block does NOT auto-expand

Design-doc §5.3 mentions an auto-expand setting. Deferred to Phase 4. Reason: it interacts awkwardly with `prefetchOnSegmentation = false` (forces a 3s spinner the user didn't ask for) and it's pure polish.

---

## 6. Public interfaces

### 6.1 `ExplanationDeps` and `explain`

```ts
// src/engine/explanationAgent.ts

export interface ExplanationDeps {
  readonly adapter: LLMAdapter;
  readonly logger?: (msg: string) => void;
  readonly token?: vscode.CancellationToken;
  readonly onPartial?: (partial: { summary?: string }) => void;
  /** Phase 5 hook — always undefined in Phase 2. See POST_MVP_VISION.md. */
  readonly additionalContext?: string;
  /** Override for tests. */
  readonly maxSegmentLines?: number;
  readonly streamIdleTimeoutMs?: number;
}

export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation>;

export const EXPLANATION_PROMPT_VERSION = "v1";  // bump on material edits to explanation.md
export const DEFAULT_MAX_SEGMENT_LINES = 400;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
```

### 6.2 `Explanation` schema

```ts
export interface Explanation {
  segmentId: string;                // content-hash from segmenter
  summary: string;                  // paragraph Markdown
  pointsToConsider: {
    assumptions: string[];          // each ≥ 15 chars, specific not generic
    dangers:     string[];
    sideEffects: string[];
  };
  concepts: Concept[];              // 0–5 items
  renderState: "streaming" | "done" | "error";
}

export interface Concept {
  name: string;                     // e.g. "Closure", "Dependency Injection"
  briefExplainer: string;           // 2–3 sentences, concept-in-general
  relevance: string;                // 1 sentence, why it matters in THIS block
}
```

### 6.3 `ExplanationStore`

```ts
// src/engine/explanationStore.ts

export class ExplanationStore implements vscode.Disposable {
  constructor(context: vscode.ExtensionContext, logger?: (msg: string) => void);

  get(segmentId: string, preset: string, promptVersion: string): Explanation | undefined;
  set(segmentId: string, preset: string, promptVersion: string, exp: Explanation): void;
  /** Emits segmentId whenever an entry for that id is written. */
  readonly onDidChange: vscode.Event<string>;
  /** Manual invalidation — used by Phase 2 tests and future Phase 5 symbol-context flows. */
  clear(): void;
  dispose(): void;
}
```

**Persistence details.**
- Storage key format: `explanation:${preset}:${promptVersion}:${segmentId}`.
- Values are JSON-serialized `Explanation` records.
- `get` never returns `renderState: "streaming"` entries to consumers — streaming placeholders are memory-only; a persisted `streaming` entry is treated as a cache miss and re-fetched. This protects against mid-stream window crashes.
- On construction, enumerate all `explanation:*` keys in `globalState`, drop entries whose `promptVersion` ≠ the current `EXPLANATION_PROMPT_VERSION`. Automatic schema migration.

### 6.4 `CodeWalkCommentController`

```ts
// src/providers/commentController.ts

export class CodeWalkCommentController implements vscode.Disposable {
  constructor(
    segmentStore: SegmentStore,
    explanationStore: ExplanationStore,
    agentDeps: Omit<ExplanationDeps, "token" | "onPartial">,
    logger?: (msg: string) => void,
  );

  /** Expand the panel for segmentId, or toggle-collapse if it's already open. */
  expand(segmentId: string): Promise<void>;

  /** Explicitly collapse whatever is currently open. */
  collapse(): void;

  dispose(): void;
}
```

### 6.5 `PrefetchQueue`

```ts
// src/engine/prefetchQueue.ts

export interface PrefetchQueueDeps {
  readonly agentDeps: Omit<ExplanationDeps, "token" | "onPartial">;
  readonly explanationStore: ExplanationStore;
  readonly logger?: (msg: string) => void;
  readonly concurrency?: number;    // default 2
}

export class PrefetchQueue implements vscode.Disposable {
  constructor(deps: PrefetchQueueDeps);

  /** Replaces any in-flight work for this URI with a fresh batch. */
  enqueueAll(uri: vscode.Uri, segments: readonly Segment[]): void;

  /** Cancels every in-flight prefetch across all URIs. */
  cancelAll(): void;

  dispose(): void;
}
```

### 6.6 New typed errors

```ts
// exported from src/engine/explanationAgent.ts

export class SegmentTooLargeError extends Error {
  readonly segmentId: string;
  readonly lineCount: number;
  readonly maxLines: number;
  constructor(segmentId: string, lineCount: number, maxLines: number);
}

export class ExplanationStreamError extends Error {
  readonly segmentId: string;
  readonly partialBytes: number;
  readonly cause: "network" | "provider-terminated" | "parse-never-ready";
  constructor(segmentId: string, partialBytes: number, cause: ExplanationStreamError["cause"]);
}
```

Both are handled in `startWalkthrough.ts`'s `handleError` cascade (§9).

---

## 7. Explanation agent (prompt + schema + ADR-005 mapping)

### 7.1 Prompt structure — `codewalk/prompts/explanation.md`

```
You are CodeWalk's explanation agent. Your job: given ONE code block plus
its surrounding file, produce a teaching-grade explanation.

Rules:
- Summary is ONE paragraph, 2–4 sentences. Teach as if to a student who
  can read code but doesn't understand the WHY.
- Points to Consider: three arrays — assumptions, dangers, sideEffects —
  each 0–5 items. Items are SPECIFIC, never generic. Example of good:
  "The SQL query on line 14 concatenates user input without
  parameterization, enabling injection." Example of BAD: "Be careful with
  SQL."
- Concepts: 0–5 items. Include a concept ONLY if a learner might not know
  it. Each has: name, briefExplainer (2–3 sentences about the concept in
  general), relevance (1 sentence about why it matters HERE).
- Respond with ONLY the raw JSON object matching the schema. No preamble,
  no closing remarks, no Markdown fence around the JSON.

## Input
Language: {{language}}
File: {{filename}}
Block label: {{label}}
Block lines {{startLine}}–{{endLine}}:
```{{language}}
{{blockCode}}
```

Surrounding file context (for reference; do NOT explain it):
```{{language}}
{{fileContext}}
```
```

**`fileContext` construction.** Full file content, but the block itself replaced by `// <block under analysis — see above>` markers on both the first and last lines of the original range. This gives the agent cross-block awareness (what calls what inside the file) without letting it wander into explaining the wrong block. When the caller passes `fileContext === ""` (tests, or a single-block file where the context would duplicate the block), the `{{fileContext}}` block and its preceding paragraph are elided from the rendered prompt.

**`additionalContext` slot.** When `deps.additionalContext` is a non-empty string, it is appended to the user-half of the prompt *after* `{{fileContext}}` under the header `Prior context:`. The Phase 5 (Cross-file Intelligence) design fills this with symbol-sighting summaries; Phase 2 always passes `undefined` so the header is elided.

The prompt is split on `## Input` at load time per the 2026-04-20 Anthropic-compat fix: `{role: "system", content: rules}` + `{role: "user", content: language/filename/code/fileContext/additionalContext}`. Retry-path system-half is augmented with `CRITICAL: …`; user-half is unchanged.

### 7.2 ADR-005 compliance — every rule has a concrete counterpart

| Rule | Explanation agent implementation |
|---|---|
| 1. Input guard | `SegmentTooLargeError` when `segment.endLine - segment.startLine + 1 > maxSegmentLines` (default 400). Thrown before any prompt construction or adapter call. |
| 2. Parse | `response_format` per preset — `json_schema` for Anthropic, `json_object` for others (from the `structuredOutputMode` wired 2026-04-20). `ValidationFailure("response is not valid JSON" \| "missing summary field" \| "missing pointsToConsider" \| "missing concepts")` on structural failures. |
| 3. Per-item validation | `summary` ≥ 20 chars and not equal to `segment.oneLiner`. Each PTC array item ≥ 15 chars and fails a generic-phrase regex (`^(be careful\|make sure\|consider\|note that)\b`). Each `Concept` has all three fields non-empty. Items failing per-item validation are dropped; `droppedCount` tracked for diagnostics. Empty arrays in PTC/concepts are accepted — a trivial block legitimately has no dangers. |
| 4. Cross-item validation | `concepts[].name` deduped by first-occurrence. If `summary.trim().toLowerCase() === segment.oneLiner.trim().toLowerCase()`, raise `ValidationFailure("summary is identical to oneLiner")`. If per-item validation dropped everything and `summary` is also empty/invalid, raise `ValidationFailure("no fields passed validation")`. |
| 5. Retry once with threaded reason | Identical to segmenter. System-half augmented with `CRITICAL: your previous response failed validation: <specific reason>. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.`. Retry uses the non-streaming code path — user already saw the first attempt; no need to animate the retry. On retry failure, throw `MalformedResponseError` with `rawResponse: {first: ..., second: ...}`. |
| 6. Diagnostics | `logger` receives one line per successful call: `[explanation] segmentId=seg-ab12… summary=214ch assumptions=2 dangers=1 sideEffects=0 concepts=3 modelTimeMs=2341 retryFired=false`. WARN prefix if retry fired or any items were dropped. Raw code and raw prompt never logged. |
| 7. Eval harness | `test/eval/explanationEval.test.ts`, gated `EVAL_EXPLANATION=1`. See §7.3. |
| Addendum — Cancellation | `CompleteOptions.signal` from `toAbortSignal(deps.token)`. Stream iteration checks `throwIfCancelled` between chunks. Synchronous `throwIfCancelled` before first attempt and before retry. Prefetch queue owns its own per-uri `CancellationTokenSource`; commentController owns a per-segment one. |
| Addendum — Content-hash ids | No caller-visible id on `Explanation` beyond `segmentId` (already content-hashed by the segmenter). Cache key `${preset}:${promptVersion}:${segmentId}` gives the natural-invalidation property — code change → segment id change → new cache entry; prompt change → `promptVersion` bump → old cache schema dropped on `ExplanationStore` construction. |

### 7.3 Eval rubric

Fixture:

```ts
interface ExplanationFixture {
  name: string;
  segment: Segment;
  fileContext: string;
  expect: {
    mustMention: string[];                    // hard pass/fail — strings that MUST appear in summary or PTC
    mustNotMention?: string[];                // soft warning
    minSummaryLength?: number;                // soft warning
    expectedConceptsIncluding?: string[];     // soft warning — case-insensitive concept name match
  };
}
```

Runner: for each fixture, invoke `explain`. Assert `mustMention` matches appear in `summary + pointsToConsider.{assumptions,dangers,sideEffects}.join(" ")` (case-insensitive). Print one summary line per fixture:

```
[eval] jwt-block summary=214ch mustMention=["parameteriz","verify","JWT_SECRET"] PASS
       assumptions=3 dangers=1 sideEffects=0 concepts=2
       expectedConceptsIncluding=["SQL injection"] PASS
       retryFired=false modelTimeMs=2341
```

Only `mustMention` misses fail the test. `mustNotMention` / `minSummaryLength` / `expectedConceptsIncluding` misses print as warnings.

**Phase 2 seed fixture.** One hand-labeled fixture targeting the JWT-validation block (or a freshly chosen equivalent) in `test/fixtures/sample.ts`. Fixtures grow over time.

### 7.4 Streaming parser

Streaming `onPartial` uses a tolerant regex to extract just the `summary` field from the in-flight JSON buffer:

```ts
// Matches the body of "summary": "..." allowing standard JSON escapes. Four lines, no dependency.
const SUMMARY_RE = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/;
function extractPartialSummary(buffer: string): string | undefined {
  const match = SUMMARY_RE.exec(buffer);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);   // unescape via JSON
  } catch {
    return undefined;                       // partial escape sequence; wait for more tokens
  }
}
```

`pointsToConsider` and `concepts` are NOT streamed — partial lists render incoherently. They appear atomically at stream end.

### 7.5 Response format per preset

- `preset.structuredOutputMode === "json_schema"` (Anthropic): send `response_format: {type: "json_schema", json_schema: {name: "CodeWalkExplanation", strict: true, schema: EXPLANATION_JSON_SCHEMA}}`.
- `preset.structuredOutputMode === "json_object"` (everyone else): send `response_format: {type: "json_object"}` + schema described in the system prompt.

`EXPLANATION_JSON_SCHEMA` is a top-level constant mirroring `SEGMENT_JSON_SCHEMA`'s location/pattern.

---

## 8. Caching

**Key.** `explanation:${preset}:${promptVersion}:${segmentId}`.

**Storage.** `ExtensionContext.globalState` — user-global, survives reloads and workspace switches. Cross-project sharing is intentional: two projects with byte-identical code blocks (boilerplate, copied utilities) hit the same entry; the explanation is correct for both. Workspace-keyed caching (prefix with `workspaceUri`) was considered and rejected as YAGNI for Phase 2.

**Invalidation.**
- Code changes → new segment id (content hash) → new cache entry.
- Prompt iteration → bump `EXPLANATION_PROMPT_VERSION` constant → old-version entries dropped on `ExplanationStore` construction.
- Backend swap → `preset` component of key changes → fresh explanations automatically.
- Manual → `codewalk.resetExplanationCache` command (new; mirrors `codewalk.resetApiKey` pattern).

**Size ceiling.** Not enforced in Phase 2. `globalState` is disk-backed; a rough estimate is ~2 KB per explanation; 10,000 cached explanations ≈ 20 MB. Acceptable for the MVP. A size/age sweep is a Phase 4 polish question.

**Streaming placeholders and error states.** `renderState: "streaming"` and `renderState: "error"` entries live in the in-memory Map only. They are NEVER persisted to `globalState`. Only `renderState: "done"` entries survive reload. If a window crashes mid-stream, the next session sees no trace of the incomplete call and re-fetches cleanly.

---

## 9. Error handling

### 9.1 Click-path cascade (additions to Phase 1)

| Failure | Typed error | User-facing message | Output channel log |
|---|---|---|---|
| Block > `maxSegmentLines` | `SegmentTooLargeError` | `"This block is too large to explain right now (520 / 400 lines)."` + note about `codewalk.explanation.maxSegmentLines` in the message | `[explanation] WARN segmentTooLarge segmentId=… lines=520` |
| Stream drops (network) | `ExplanationStreamError{cause:"network"}` | First attempt: silent retry via ADR-005. If retry also drops: `"Couldn't finish the explanation — the connection dropped. Try again."` | `[explanation] WARN streamError segmentId=… bytes=1247 cause=network` |
| Stream stalls (no tokens for 60s) | `ExplanationStreamError{cause:"provider-terminated"}` | Retry once; if retry also stalls, same toast as above. | `[explanation] WARN streamTimeout segmentId=… cause=provider-terminated` |
| Final JSON invalid even after retry | `MalformedResponseError` (existing) | Existing Phase 1 toast. | existing |
| Cancelled mid-stream | `CancelledError` (existing) | Silent. Thread body replaced with `_Cancelled._` so the user can see where they were. | `[explanation] cancelled segmentId=…` |
| User clicks a different block mid-stream | (not an error) | Old thread collapses. New thread opens. | `[explanation] interrupted segmentId=… (user switched)` |

Additions to `startWalkthrough.ts`'s `handleError` cascade (ordered above the existing `NetworkError` branch):

```ts
if (err instanceof SegmentTooLargeError) {
  window.showWarningMessage(
    `This block is too large to explain right now (${err.lineCount} / ${err.maxLines} lines).`,
  );
  return;
}
if (err instanceof ExplanationStreamError) {
  window.showErrorMessage("Couldn't finish the explanation — the connection dropped. Try again.");
  return;
}
// ... existing handleError branches unchanged ...
```

### 9.2 Prefetch failures (silent-by-default)

- All agent errors during prefetch are caught inside `PrefetchQueue` and logged at `[prefetch]` prefix. No toasts, no thread creation, no cache write.
- On `AuthError` specifically, disable the queue for the session (set an internal boolean) and log `[prefetch] disabled: auth failed — fix API key and reload`.
- Rationale: the user didn't ask for prefetch; failures shouldn't interrupt them. Session-wide disable avoids a pile of identical log lines every time segmentation fires.

### 9.3 Cache persistence failures

- `globalState.update` throws → catch inside `ExplanationStore.set`, log `[explanationStore] WARN persistence failed: <reason>`, return successfully (the in-memory Map has the entry). The user sees their explanation; cache simply doesn't survive reload this time.
- `globalState.get` returning malformed JSON → treat as cache miss, log warning, refetch.

### 9.4 Streaming rollback

If the stream dies after a partial summary rendered, the panel body is replaced with `_Couldn't finish the explanation — retrying…_` before the retry fires, and with the final error message if the retry also fails. No stale partial text is ever left visible when the call has failed.

---

## 10. Testing

### 10.1 Unit tests (new files under `codewalk/test/suite/`)

**`explanationAgent.test.ts`** — every ADR-005 rule gets at least one test:

- Input guard: `throws SegmentTooLargeError before calling the adapter when segment > 400 lines`.
- Parse: `throws MalformedResponseError after two failed JSON attempts`.
- Per-item validation: `rejects summary shorter than 20 chars`; `rejects generic PTC phrases like "be careful"`; `rejects concept with empty briefExplainer`.
- Cross-item validation: `dedupes duplicate concept names`; `raises ValidationFailure when summary equals segment.oneLiner`.
- Retry with threaded reason: `retry prompt includes specific validation failure reason`.
- Diagnostics: `logger receives segmentId, field counts, modelTimeMs`; `logger does not receive raw code or raw prompt`.
- Cancellation: `throws CancelledError synchronously if token cancelled before first attempt`; `aborts mid-stream when token cancels`.
- `additionalContext` hook: `passes additionalContext string into the rendered prompt when provided`.
- Streaming: `onPartial fires with partial summary as tokens arrive`; `onPartial does not fire with invalid partial JSON`.
- Stream timeout: `aborts with ExplanationStreamError after streamIdleTimeoutMs of no tokens`.

**`explanationStore.test.ts`**:

- `cache key includes preset, promptVersion, segmentId`.
- `get returns undefined when any key component differs`.
- `set persists to globalState on success` (uses a mock `Memento`).
- `set does not throw when globalState.update rejects; returns the entry in memory anyway`.
- `construction rejects malformed entries and drops entries with wrong promptVersion`.
- `streaming-state entries are never persisted to globalState`.
- `clear() empties both memory and globalState`.

**`commentController.test.ts`**:

- `expand creates a thread at segment.range`.
- `expand collapses the previously open thread`.
- `re-expanding the same open segment collapses it (toggle)`.
- `cache hit renders final Markdown directly, no streaming replay`.
- `cache miss triggers agent call with onPartial wired to thread body`.
- `agent error replaces thread body with error text, does not dispose thread`.
- `switching to a different editor does not collapse the open thread`.

**`prefetchQueue.test.ts`**:

- `enqueueAll schedules each segment with concurrency 2`.
- `dedupes against segments already in the cache (both done and streaming)`.
- `token cancellation aborts all in-flight requests`.
- `AuthError disables queue for the session; subsequent enqueueAll is a no-op`.
- `SegmentStore.onDidChange for same uri cancels old queue, starts fresh`.
- `prefetch errors other than AuthError do not disable the queue`.

### 10.2 Eval harness — `test/eval/explanationEval.test.ts`

Gated by `EVAL_EXPLANATION=1`. One seeded fixture. Per §7.3 rubric. Per ADR-005 §7 — trend signal, not CI gate.

### 10.3 Integration test — `test/integration/explanationLive.test.ts`

Gated by `CODEWALK_LIVE_EXPLANATION=1`. Uses the user's configured backend (wizard-saved). One end-to-end test: segment a small file → call `explain` on one segment → assert non-empty explanation + schema valid. Skipped in CI without the env var, same pattern as Phase 1's Ollama integration test. Rationale: catches OpenAI-compat spec drift at real providers (the 2026-04-20 Anthropic / Groq bugs).

### 10.4 Manual verification checklist

Appended to `docs/PROJECT_STATE.md` at Phase 2 boundary. Scoped to what automation can't catch:

- **Streaming visibly feels like streaming** — summary paragraph renders progressively, not in one jump.
- **Concepts `<details>` block is collapsed by default.**
- **Only one panel open at a time** — click block A, click block B; A's thread disappears.
- **Re-click toggle** — click block A, click block A again; thread disappears.
- **Cache survives reload** — click a block, reload window, click again → instant (no spinner).
- **Prompt version bump invalidates cache** — edit `EXPLANATION_PROMPT_VERSION` (or `explanation.md`), reload → next click refetches.
- **Prefetch on/off** — toggle `codewalk.explanation.prefetchOnSegmentation`; with it on, the second-and-later clicks feel instant; with it off, every fresh click shows the streaming state.
- **Cancellation during stream** — click a block, immediately cancel; the thread either disposes or shows `_Cancelled._`.
- **Auth-disable prefetch** — set a deliberately wrong API key, run a walkthrough → after the first auth failure, Output channel shows `[prefetch] disabled`; no further prefetch attempts that session.

---

## 11. Dependencies on Phase 1

Phase 2 builds on these Phase 1 pieces without refactoring them:

- `codewalk.expandBlock` command registered as a no-op stub — body swaps in Phase 2.
- `SegmentStore.onDidChange(uri)` event — `CommentController` and `PrefetchQueue` subscribe as third and fourth listeners.
- `SegmentStore.get(uri)` — `CommentController` resolves `segmentId` → `Segment` via a linear scan of the store (O(n) per click is fine; n < 100 in practice).
- Content-hash `Segment.id` — cache key component.
- `LLMAdapter` / `OpenAICompatibleAdapter` — gains a streaming code path; non-streaming `complete` unchanged.
- `CancellationToken` / `AbortSignal` plumbing from ADR-005 addendum.
- Prompt loader (`loadPrompt("explanation")`).
- Typed errors (`NetworkError`, `AuthError`, `RateLimitError`, `MalformedResponseError`, `CancelledError`) — `explanation.md` pipeline reuses them.
- First-run wizard + SecretStorage — unchanged; reads `getApiKey(context)` like the segmenter.
- `ExtensionContext.globalState` — new user for the `ExplanationStore`.

---

## 12. Settings surface (additions to `package.json`)

```json
{
  "codewalk.explanation.prefetchOnSegmentation": {
    "type": "boolean",
    "default": false,
    "description": "If enabled, explanations for every segment are fetched in the background immediately after segmentation, so later CodeLens clicks are instant. Costs extra LLM calls for blocks you may never open."
  },
  "codewalk.explanation.streamIdleTimeoutMs": {
    "type": "number",
    "default": 60000,
    "description": "Abort an explanation if no tokens arrive from the backend for this many milliseconds."
  },
  "codewalk.explanation.maxSegmentLines": {
    "type": "number",
    "default": 400,
    "description": "Skip explanation for blocks longer than this many lines. Prevents the LLM from choking on pathological input."
  }
}
```

New command contribution (per §2.1 item 12):

```json
{
  "command": "codewalk.resetExplanationCache",
  "title": "CodeWalk: Reset Explanation Cache"
}
```

Clears every `explanation:*` key from `globalState`. Does NOT clear the SecretStorage API key or the `codewalk.apiKey` migration flag — those have their own dedicated command (`codewalk.resetApiKey`).

---

## 13. Risks and open questions

### Risks the plan must handle

1. **Streaming JSON partial-parse correctness.** The `summary`-field regex is tolerant but not bulletproof. If a backend emits escape sequences split across token boundaries, a partial match may render a truncated string with a dangling `\`. The unescape via `JSON.parse` handles this by returning `undefined` on malformed partial; `onPartial` then waits for the next token. Test coverage required: malformed partial escapes, multibyte characters split across tokens.
2. **`response_format: "json_object"` with streaming.** Several providers (verified at Groq on 2026-04-20) accept `json_object` + streaming. Anthropic's OpenAI-compat endpoint with `json_schema` + streaming needs explicit verification during the smoke-test pass at Phase 2 boundary. Fallback: disable streaming per-preset via a new `supportsStreaming: boolean` field on `PresetConfig` if any provider can't do both at once.
3. **CommentController re-render cadence.** Updating `CommentThread.comments` on every streamed chunk is idiomatic but might flicker on slow backends. Plan should include a debounce (e.g. 50ms or on every sentence boundary) if manual verification reveals flicker.
4. **Stale cache across extension upgrades.** Bumping `EXPLANATION_PROMPT_VERSION` is a human-in-the-loop step. If a dev edits `explanation.md` without bumping the constant, users see stale explanations until their cache happens to evict. Mitigation: eval harness catches the behavioral drift; a pre-commit hook could parse the markdown frontmatter for version drift, but is out of Phase 2 scope.

### Open questions (deferred to Phase 2b or later)

- Auto-expand of the first block (design-doc §5.3).
- Anthropic prompt caching escape hatch through the unified adapter.
- Cache size/age sweep policy.
- Per-backend `supportsStreaming` flag if a provider rejects streaming + structured output simultaneously.

---

## 14. Demo target

Open `codewalk/test/fixtures/sample.ts`. Run `CodeWalk: Start Walkthrough`. Wait for segmentation. Click the `▶ JWT Validation — …` CodeLens. The panel expands inline below the label. The summary paragraph streams in over 2–5 seconds. Points to Consider appears as three sub-headings with bullet lists. A `<details>Concepts (N)</details>` block is visible at the bottom, collapsed; clicking it reveals 1–3 tagged concepts with explainers. Click a different block's CodeLens — the first panel disappears, a new one opens. Click the same CodeLens again — the panel disappears. Reload the window. Click the same CodeLens. The panel opens instantly with the full, identical content — cache hit.

---

## 15. Future work

**Phase 5 — Cross-file Intelligence** is captured in `docs/POST_MVP_VISION.md`. Phase 2 preserves one hook for it — `ExplanationDeps.additionalContext?: string` — which is always `undefined` in Phase 2 and is filled by the Phase 5 symbol-context accumulator. No other Phase 2 surface changes for Phase 5 readiness.

**Explanation schema redesign (in-flight Phase 2 work).** The 2026-04-20 brainstorm reshaping the `Explanation` schema (kind-tagged, `purpose`/`flow`/`uses`/`produces`/`watch` with tight caps, PTC collapsed into `watch`) is preserved verbatim in [`docs/superpowers/specs/2026-04-20-codewalk-phase2-explanation-schema-brainstorm.md`](2026-04-20-codewalk-phase2-explanation-schema-brainstorm.md). Supersedes §6.2 / §7 contents once landed. Re-read before editing `Explanation` or `explanation.md`.

Other post-MVP ideas (difficulty color coding on CodeLens labels themselves, walkthrough summary at completion, export as Markdown, difficulty-based filtering) remain deferred to Phase 4 or later per `IMPLEMENTATION_PLAN.md`.
