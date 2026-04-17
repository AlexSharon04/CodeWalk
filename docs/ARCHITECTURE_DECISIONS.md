# CodeWalk — Architecture Decision Records

Each ADR captures a decision that deviates from or materially refines `CodeWalk-design-doc.md`. Ordered chronologically. New ADRs append to the bottom.

---

## ADR-001 — Unified OpenAI-compatible adapter

**Status.** Accepted (2026-04-17)
**Supersedes.** `CodeWalk-design-doc.md` §3.5 (four separate adapter implementations)

**Context.**
The design doc lists four adapter implementations: Ollama, Groq, Anthropic, OpenAI. Each would be a separate TypeScript class with provider-specific request/response shapes. This design predates the industry-wide adoption of OpenAI-compatible HTTP endpoints as a de-facto standard.

**Decision.**
Implement a single `OpenAICompatibleAdapter` parameterized by `(baseUrl, apiKey, model)`. Treat Ollama as a thin special case that adds localhost auto-detection on top of the same adapter (because Ollama exposes an OpenAI-compatible endpoint at `/v1/chat/completions`).

**Rationale.**
Every provider CodeWalk might want — Groq, OpenRouter, Together.ai, Fireworks, Ollama, LM Studio, vLLM, and Anthropic via their 2024 OpenAI-compat endpoint — speaks the same `POST /chat/completions` contract. A single adapter replaces four at roughly 25% of the code volume, and adding a new provider becomes a config preset change rather than a code change.

**Consequences.**
- Users configure any provider through a preset dropdown plus `apiKey`, `model`, and `baseUrl`. OpenRouter becomes one preset among several, not a required dependency.
- Provider-specific features (e.g., Anthropic's prompt caching headers, Claude-specific structured outputs) are not reachable without future escape hatches. Acceptable for Phase 1; revisit if a specific feature becomes load-bearing.
- Removes Groq/Anthropic/OpenAI-specific settings from `package.json`; replaced by the four generic keys above.

---

## ADR-002 — Externalized prompt templates

**Status.** Accepted (2026-04-17)
**Supersedes.** `CodeWalk-design-doc.md` §11 in part (prompts relocate; everything else in §11 stands).

**Context.**
The design doc's file structure places all prompts in `src/utils/prompts.ts` as string constants. For an AI-agents course project, prompt iteration is the central craft and will happen frequently.

**Decision.**
Prompts live as standalone markdown files under `prompts/` (e.g., `prompts/segmentation.md`). A small loader reads and caches them at runtime. Template variables use `{{placeholder}}` string replacement.

**Rationale.**
- **Iteration cost.** Editing a `.ts` file requires esbuild rebuild + extension host reload (~10–15 s). Editing a `.md` file requires only a re-run of the command (~2 s).
- **Pedagogical clarity.** Git diffs on markdown show prompt evolution as clean before/after text, which is valuable for a class report on agent development.
- **Separation of concerns.** Prompts are content, not code. Keeping them separate matches their nature.

**Consequences.**
- Small runtime cost: one file read per prompt on first use (cached thereafter).
- Prompts lose TypeScript template-literal safety. Mitigated by the loader throwing on missing `{{placeholder}}` substitutions.
- Extension packaging must include `prompts/` in the `.vsix` bundle (add to `files` or ensure it's not in `.vscodeignore`).

---

## ADR-003 — Ollama-local as shipped default backend

**Status.** Accepted (2026-04-17)
**Refines.** `CodeWalk-design-doc.md` §3.5 (same provider priority; adds concrete first-run UX).

**Context.**
The design doc suggests auto-detecting Ollama first, then falling back to whichever cloud key is configured. "Auto-detect" was left underspecified. Sustainability analysis (see session notes 2026-04-17) indicates local LLMs are the more durable long-term choice: they are not subject to free-tier erosion, work offline, require no account, and consumer hardware is trending toward local-inference capability.

**Decision.**
The extension ships with `codewalk.backend = "ollama-local"` as the default preset. On first run:
1. If `GET http://localhost:11434/api/tags` succeeds, use Ollama directly.
2. If it fails, show a one-time info notification: "CodeWalk needs an LLM backend. Choose one to continue." with a button that opens the preset picker.

**Rationale.**
Local LLMs are improving rapidly (Qwen 2.5 Coder 7B ≈ GPT-3.5-turbo on coding benchmarks as of late 2024) while free cloud tiers trend toward stricter limits over time. An account-free, privacy-preserving, offline-capable default is the user-friendliest baseline; cloud backends remain one settings change away.

**Consequences.**
- End users without Ollama see a one-time setup prompt rather than a silent failure.
- Users on low-end hardware (integrated GPU, <16 GB RAM) will likely switch to a cloud preset. That's an acceptable branching path, not a failure mode.
- The developer's own dev loop is too slow on Ollama with integrated graphics. Developer uses a cloud preset (Groq free tier) via personal `settings.json`, which means the shipped default is not the developer's daily experience. Risk of blind spots in Ollama-specific UX. **Mitigation.** Periodic "dogfood with Ollama" manual-test checkpoint during Phase 1 polish and at every phase boundary.

---

## ADR-004 — First-run QuickPick wizard for backend setup

**Status.** Accepted (2026-04-17)
**Supersedes.** Phase 1 spec §2.1 item 4 (the "show info notification with Open Settings button" first-run flow).

**Context.**
The Phase 1 spec specified a minimal first-run UX: if no backend is configured, show a single information notification with an "Open Settings" button. The user would then paste their API key into `codewalk.apiKey` in the standard VS Code settings UI. During Phase 1 manual verification, this flow was tested and judged too high-friction for new users — a fresh installer has no idea what `codewalk.apiKey`, `codewalk.backend`, or `codewalk.baseUrl` mean, what a Groq key is, or where to get one.

**Decision.**
Add a new `codewalk/src/commands/firstRunWizard.ts` module that runs a multi-step `QuickPick` + `InputBox` flow the first time the user runs `Start CodeWalk` without a configured backend. Steps:

1. **Backend picker** — `showQuickPick` with seven options (Groq, Ollama-local, OpenRouter, Anthropic, OpenAI, Together, Custom), each with a one-line description and a detail line.
2. **baseUrl prompt** — only for Custom backend; plain `showInputBox`.
3. **API-key prompt** — for every backend except Ollama-local; `showInputBox` with `password: true` and a prompt that includes the provider's key-generation URL (e.g. `https://console.groq.com/keys` for Groq).
4. **Save** — write backend, apiKey, baseUrl to `ConfigurationTarget.Global`; clear `codewalk.model` so the new preset's default applies.
5. **Proceed** — return the resolved backend; `startWalkthrough` continues with the segmentation call immediately, no re-run needed.

The wizard triggers from `startWalkthrough.ts` when `(ollama-local selected AND localhost:11434 unreachable) OR (cloud backend selected AND apiKey empty)`.

**Rationale.**
- **New-user friction reduction.** The `Open Settings` flow required ~7 clicks and domain knowledge (what is an API key, which backend to choose, where to get one). The wizard is 2–3 prompts with guidance text.
- **Settings remain the source of truth.** The wizard writes to the same settings the old flow edited manually — no new state, no config duplication. Power users can still bypass the wizard by pre-configuring settings.
- **Native UI.** `QuickPick` and `InputBox` are VS Code's built-in primitives. No webview, no HTML, no theme management, no ~400 KB of webview bundle. The wizard is ~110 lines of TypeScript.
- **Secret hygiene.** `password: true` on the API-key input masks typing so keys don't appear in screenshots or screen-share.

**Consequences.**
- `showSettingsInfo` helper in `startWalkthrough.ts` is removed; its only callers now invoke the wizard. `showSettingsError` remains for auth/malformed-response error paths.
- The wizard writes to `ConfigurationTarget.Global`, so keys persist across workspaces but never commit to a project's `.vscode/settings.json`.
- If the user picks Ollama-local in the wizard but Ollama still isn't running, a targeted error ("CodeWalk can't reach Ollama at …") fires rather than the generic "couldn't reach the LLM" that would come later from the adapter.
- No unit tests — `QuickPick` / `InputBox` interactions require extension-host UI automation that's disproportionate to the payoff. The wizard calls `resolveBackend` (already tested in Task 6) for its return value.

---

## ADR-005 — LLM-call validation contract (segmenter canonical, explanation to follow)

**Status.** Accepted (2026-04-17)
**Refines.** Phase 1 spec §4.5 and §6 (segmenter behavior, error handling).
**Applies to.** Every LLM-backed component from Phase 1 onward — starting with the segmenter, extended by Phase 2's explanation agent, Phase 4's line-by-line annotator, and any future `prompts/*.md` prompt.

**Context.**
The Phase 1 spec described the segmenter as a "parse → validate → retry once → return" pipeline, but left several cross-cutting rules implicit: what constitutes a validation failure, what the retry prompt must say, whether partial drops are acceptable, and how diagnostics surface to the user. In practice, LLM outputs fail in predictable ways — overlapping ranges, missing lines, silent quality degradation on weak models, oversized inputs that blow token budgets — and each failure mode needs a defined response. A post-Phase-1 hardening pass (see `PROJECT_STATE.md` recent decisions) codified these rules in the segmenter. Phase 2's explanation agent will need the same shape, and without a written contract it will drift.

**Decision.**
Every LLM-backed component in CodeWalk MUST implement the following pipeline, and any deviation MUST be justified in its own ADR.

### 1. Input guard (pre-LLM)
- Before constructing any prompt, reject inputs that exceed the component's documented budget by throwing a typed error subclassing `Error` (pattern: `FileTooLargeError` in `src/engine/segmenter.ts`). Never truncate silently.
- Typed input-guard errors must expose the offending metric and the limit as readonly fields (`lineCount`, `maxLines` on `FileTooLargeError`).
- Limits are exported constants (e.g. `DEFAULT_MAX_LINES = 2000`) overridable via the component's `Deps` interface, so tests and the eval harness can exercise the boundary without editing globals.

### 2. Parse
- Adapter is called with `responseFormat: "json_object"` on the first attempt. Parse failures throw an internal `ValidationFailure` with a human-readable reason (e.g. `"response is not valid JSON"`, `"response does not contain a 'segments' array"`). `ValidationFailure` is private to the component — it never leaks to callers; it is either recovered by the retry or repackaged as `MalformedResponseError`.

### 3. Per-item validation
- Each item in the response is validated independently. Items that fail are dropped, and a `droppedCount` is tracked.
- If after per-item validation the result set is empty, raise `ValidationFailure("no items passed per-field validation")` — do NOT return an empty result to the caller.
- Clamp obviously-recoverable out-of-range values (e.g. `endLine > document.lineCount` → clamp to `lineCount`). Clamping is preferable to dropping for errors the LLM commonly makes at document boundaries. Document every clamp in the prompt's comments and in the component's tests.

### 4. Cross-item validation
- After per-item validation and sorting, enforce invariants the prompt promised to the model (the segmenter promises non-overlap; future components will have their own). Invariant violations raise `ValidationFailure` with a message that names the conflicting items (e.g. `'segments overlap: "A" (1-3) and "B" (3-5)'`). Generic messages like `"validation failed"` are insufficient — the retry depends on specificity.
- Enforce a deterministic sort order before assigning caller-visible identifiers (the segmenter sorts by `startLine` before assigning `seg-${i}`). Deterministic ids are a Phase-3 precondition for prev/next navigation.

### 5. Retry (exactly once)
- On `ValidationFailure` or `MalformedResponseError` from the first attempt, retry once with an augmented system message that threads the specific failure reason back to the model. The addendum must begin with `CRITICAL:` and name the exact failure (e.g. `"CRITICAL: your previous response failed validation: segments overlap: "A" (1-3) and "B" (3-5). Respond with ONLY the raw JSON object matching the schema..."`). Generic "try again" text without the failure reason is a regression and will be caught by the `retry prompt includes the specific validation failure reason` test pattern.
- If the retry also fails for any reason (validation, malformed JSON, network error, adapter exhausted in tests), raise `MalformedResponseError` with `rawResponse` containing both attempts as JSON: `{"first": ..., "second": ...}`. Do not retry a third time.
- Retry behavior is capped at one attempt per LLM call. No exponential backoff, no recursion. A component that needs more sophisticated retry (e.g. streaming reconnect) gets its own ADR.

### 6. Diagnostics
- `Deps` interface MUST accept an optional `logger: (message: string) => void`. Default is a no-op.
- Every successful call logs one line at `[component]` prefix with: item count, coverage ratio (or analogous quality metric), and drop count when non-zero. Example: `[segmenter] 5 segment(s), coverage 87%, dropped 2`.
- When a quality metric falls below the component's threshold (segmenter: `MIN_COVERAGE_RATIO = 0.7`), emit a WARN-prefixed second log line. The UI does not currently surface these, but the Output channel does; future UX can escalate them to user notifications without code surgery.
- Secrets (API keys, raw prompts containing user source) MUST NOT be logged. Log metadata about the prompt (length, model), not its body.

### 7. Eval harness
- Each component that produces structured output gets a golden-fixture evaluator at `test/eval/<component>Eval.test.ts`. Gated behind a component-specific env var (`EVAL_SEGMENTER=1`, `EVAL_EXPLANATION=1`, etc.) so local `npm test` stays fast and CI-independent.
- Scoring uses a metric appropriate to the output type — IoU over line ranges for segmentation, rubric-scored similarity for explanations (Phase 2 will define). Print one summary line per fixture; fail the test only when thresholds are violated.
- Fixtures seed with one hand-labeled example and grow over time. The eval is a trend monitor, not a pass/fail gate — thresholds are tuned loose enough to tolerate weak-model noise, tight enough to catch prompt regressions.

**Rationale.**
- **Cross-item invariants are the LLM failure mode.** Schema-shape validation is easy; the model fills the slots. Rules about how items relate (overlap, coverage, ordering) are where weak models and tired models silently produce broken output. Encoding these rules once, in code, turns "silent UI bug" into "retry opportunity" in every component that follows the pattern.
- **Specific retry beats strict retry.** A retry prompt that says "be stricter" doesn't move a Llama 3.3 past a mistake. Threading the exact validation failure back to the model ("your response overlapped segments X and Y") typically fixes the issue in one additional round, which is the difference between a functional extension on cheap local models and one that only works on Claude Sonnet.
- **Diagnostics as a ports-and-adapters boundary.** Components don't know about `OutputChannel`; they accept a `(msg: string) => void`. Same surface redirects to an in-memory buffer for tests, to `console.log` in the eval harness, to the Output channel in production. Testability and production observability are the same concern.
- **Eval harness as trend signal, not CI gate.** A tight eval threshold fails constantly on small local models and gets muted; a loose one with printed summaries lets the developer watch the IoU trend across prompt edits. The second is far more useful. Phase 2's explanation eval will follow the same philosophy (rubric-score printouts, threshold on catastrophic regressions only).

**Consequences.**
- Phase 2's `prompts/explanation.md` must mirror the contract. The explanation agent will have its own `ExplanationValidationFailure`-equivalent, its own `CRITICAL: …` retry addendum threading the failure reason, and its own eval harness at `test/eval/explanationEval.test.ts` with rubric-based scoring.
- New typed errors may be added (the segmenter added `FileTooLargeError`); they must be exported alongside `adapter.ts` error classes and handled in `startWalkthrough.ts`'s `handleError` cascade with a user-facing message.
- The retry-once-with-specific-reason pattern is load-bearing. If Phase 3's streaming explanation ever needs multi-step retry, it must file a superseding ADR rather than ad-hoc extending this contract.
- `DEFAULT_MAX_LINES = 2000` is a fixed ceiling for Phase 1. Users hitting it on large files see a targeted warning, not a silent failure. Raising or making it configurable is a Phase 4 polish question, not a Phase 2 blocker.
- The eval harness is manual-invocation (gated env var). CI remains Ollama-free. A future ADR can formalize periodic eval runs (e.g. a scheduled GitHub Action against a hosted model), but that's out of scope for the MVP.

**Test coverage (reference implementation — segmenter).**
All seven contract rules have at least one test in `codewalk/test/suite/segmenter.test.ts`:
- Input guard: `throws FileTooLargeError before calling the adapter`.
- Parse: `throws MalformedResponseError after two failed attempts`.
- Per-item validation: `rejects segments with endLine < startLine`, `rejects segments with empty label`, `clamps endLine to document lineCount`.
- Cross-item validation: `rejects overlapping segments (triggers retry)`, `sorts segments by startLine before returning`.
- Retry: `retries on malformed JSON and succeeds`, `retry prompt includes the specific validation failure reason`.
- Identifier stability: `segment ids are stable across identical re-runs`, `segment ids change when block content changes`.
- Diagnostics: `logger receives segment count, coverage, and drop count`.
- Eval harness: `test/eval/segmenterEval.test.ts` — gated by `EVAL_SEGMENTER=1`, IoU over one golden fixture.

Phase 2's explanation agent is expected to ship with equivalents for every bullet above.

### Addendum (2026-04-17) — Cancellation and content-hash identifiers

Two further rules folded into the contract after the initial draft landed, because both are visible at the `Deps` surface and Phase 2 callers will rely on them:

**Cancellation propagation.** `Deps` MUST accept an optional `token: vscode.CancellationToken`. Implementations translate it to an `AbortSignal` (see `toAbortSignal` helper in `segmenter.ts`) and pass that to `adapter.complete` via `CompleteOptions.signal`. Cancellation is also checked synchronously (`throwIfCancelled`) between LLM calls — before the first attempt, and between the first attempt and the retry — so a user cancel during the retry gap doesn't burn the second call. On cancellation, adapters throw `CancelledError` (exported from `adapter.ts` alongside the other typed errors); the segmenter re-throws it without wrapping, and `startWalkthrough.ts`'s `handleError` treats it as a silent Output-channel log line (no toast, no error modal). The Progress notification runs with `cancellable: true`, so a Cancel button appears automatically. Phase 2's explanation panel, which opens during a walkthrough, MUST thread the same token so the user can abort a slow expansion the same way.

**Content-hash identifiers.** Caller-visible ids are derived from segment content (label + startLine + endLine + code text), not from return order. Reference implementation: `computeSegmentId` in `segmenter.ts` returns `seg-<12 hex chars>` from a SHA-256 of a null-byte-separated tuple. This change — superseding the earlier `seg-${i}` scheme — is load-bearing for Phase 2: when the user re-runs `Start CodeWalk` on an unchanged file, they should see the SAME ids, so any explanation cache Phase 2 builds keys correctly across runs. When block content changes, ids change, and the stale cache entry is naturally orphaned. Tests `segment ids are stable across identical re-runs` and `segment ids change when block content changes` pin this behavior. Phase 2's explanation records MUST also use content-derived ids (likely `exp-<hash-of-segment-id+prompt-version>`) for the same cache-eviction property.
