# CodeWalk — Project State

**Last updated:** 2026-05-06
**Current phase:** Phase 2c — single-narrative v3 schema + adjacent prefetch — **code complete, Phase 3 nav next**
**Current branch:** `phase2c-narrative-and-nav`
**Current step:** Phase 2c steps 1-6 of 12 complete (schema migration + adjacent prefetch). Steps 7-12 (Phase 3 full nav) pending user verification of the v3 prose output and adjacent-prefetch behavior in the Extension Development Host before proceeding.

## Phase status
- [x] Phase 1 — Core Loop — **code complete 2026-04-17; cloud path verified 2026-04-20 against Anthropic (Claude Sonnet 4.6) and Groq (llama-3.3-70b-versatile)**
- [x] Phase 2 — Level 1 Explanations — **code complete 2026-04-20; superseded by Phase 2b**
- [x] Phase 2b — Adaptive kind-aware schema (kind + purpose + flow + uses + produces + watch + concepts) — **code complete 2026-04-20; superseded by Phase 2c**
- [~] Phase 2c — Single-narrative v3 schema + adjacent prefetch — **schema + prefetch code complete 2026-05-06; Phase 3 nav slice (steps 7-12) pending**
- [ ] Phase 3 — Navigation & File Queue (folded into Phase 2c slice)
- [ ] Phase 4 — Level 2 & Polish

## Active artifacts
- Phase 1 spec: `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md` *(approved 2026-04-17)*
- Phase 1 plan: `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md` *(17 tasks, all complete)*
- Phase 2 spec: `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` *(approved 2026-04-20; plan + implementation complete)*
- Phase 2 plan: `docs/superpowers/plans/2026-04-20-codewalk-phase2-explanations.md` *(14 tasks, all complete)*
- Phase 2b spec: `docs/superpowers/specs/2026-04-20-codewalk-phase2b-adaptive-explanation.md` *(approved 2026-04-20; superseded by Phase 2c)*
- **Phase 2c plan: `docs/superpowers/plans/2026-05-06-codewalk-phase2c-narrative-and-nav.md` *(approved 2026-05-06; steps 1-6 of 12 complete on `phase2c-narrative-and-nav` branch)***
- Post-MVP vision: `docs/POST_MVP_VISION.md` *(Phase 5 — Cross-file Intelligence — parked until Phase 4 ships; **Phase 5 `uses`-text-to-link seam was dropped with v3 single-narrative — see Phase 2c plan §Risks**)*
- ADRs: `docs/ARCHITECTURE_DECISIONS.md` *(ADR-001, ADR-002, ADR-003, ADR-004, ADR-005 accepted)*
- README with user testing instructions: `codewalk/README.md`

## Phase 1 manual verification checklist (do before tagging `phase1-complete`)

Run through both backend paths. Both must pass on the current commit.

### Ollama path
- [ ] `ollama pull qwen2.5-coder:7b` and `ollama serve` running locally.
- [ ] Launch Extension Development Host (F5 in `codewalk/`).
- [ ] Open `codewalk/test/fixtures/sample.ts`.
- [ ] Run `CodeWalk: Start Walkthrough` → wizard does NOT fire (Ollama auto-detected).
- [ ] `▶ Label — one-liner` CodeLens appears above each logical block.
- [ ] Block backgrounds tinted by difficulty.
- [ ] CodeWalk Output channel shows `[success] N segments for …`.
- [ ] Clicking a CodeLens is a no-op (expected for Phase 1).

### Cloud-API-key path — **verified 2026-04-20 against Anthropic + Groq**
- [x] Delete any stored key from SecretStorage — use `CodeWalk: Reset API Key` (new 2026-04-20).
- [x] Set `codewalk.backend = "groq"` (or another cloud preset).
- [x] Run `CodeWalk: Start Walkthrough` → wizard fires.
- [x] Pick a preset, paste a real API key → walkthrough proceeds without re-running the command.
- [ ] Cancelling the wizard cleanly aborts (no error toast, no partial state).
- [x] Restart window → wizard does NOT fire (key persisted in the OS keychain).
- [x] Confirm the key does NOT appear in `settings.json` after the wizard completes.

### Legacy-key migration (one-shot, runs on activation)
- [ ] Pre-seed `settings.json` with `"codewalk.apiKey": "sk-test-legacy"` (any value).
- [ ] Reload the window. Activation fires `migrateLegacyApiKey`.
- [ ] Verify `codewalk.apiKey` is gone from `settings.json`.
- [ ] Verify `Start CodeWalk` works without re-prompting the wizard (key is now in SecretStorage).
- [ ] Reload again — migration does NOT re-run (flag persisted in `globalState`).

### Cancellation
- [ ] Start a walkthrough on a slowish file/backend; hit the Cancel button on the "CodeWalk: Analyzing…" progress notification.
- [ ] Output channel shows `[cancelled] user cancelled CodeWalk analysis` — no error modal, no stack trace.
- [ ] No partial state: store entry for the URI is cleared, no decorations applied.

### Hash-id stability
- [ ] Run a walkthrough; note a segment id from the Output channel logs (or inspect via a debugger).
- [ ] Re-run on the same file unchanged; verify the same segment produces the SAME id.
- [ ] Modify one line inside a block; re-run; verify that block's id changes while unrelated blocks' ids stay the same.

### Error-path spot checks
- [ ] With Ollama stopped and `backend = "ollama-local"` + wizard result `ollama-local`: targeted "can't reach Ollama at …" error, not generic network error.
- [ ] Bad API key: `AuthError` path fires "API key rejected" + Open Settings button.
- [ ] `codewalk.showBlockHighlights = false`: tints disappear immediately (no walkthrough re-run needed); CodeLens labels remain.
- [ ] File > 2000 lines: warning toast "CodeWalk can't analyze files over 2000 lines yet…"; no LLM call made.
- [ ] Coverage < 70%: Output channel shows `[segmenter] WARN coverage below 70%` line alongside the summary.

### Prompt-iteration smoke test
- [ ] Edit `codewalk/prompts/segmentation.md` (e.g., change rule 7 to say 50 chars).
- [ ] Reload Extension Development Host (`Ctrl+R` inside the host window).
- [ ] Re-run Start CodeWalk → new constraint visibly reflected in one-liners.

## Phase 2 manual verification checklist (do before tagging `phase2-complete`)

### Streaming + panel behavior
- [ YES ] Open `codewalk/test/fixtures/sample.ts`. Run `CodeWalk: Start Walkthrough`.
- [ HALF, does Analyzing... static, then comes all at once, not token by token streaming :( needs improvement either with the token by token (would be so so cool), or a little loading image or a . -> .. -> ... -> . loop and a 1s ... 2s ... etc counter] Click any CodeLens. Panel opens inline below the label. Summary streams in progressively (not all at once).
- [ YES] Points to Consider renders as three sub-sections: Assumptions, Dangers, Side effects.
- [ NOTHING THERE WHEN EXPANDED ] Concepts section is a `<details>` block. Collapsed by default; expanding it reveals the tagged concepts.

### Single-panel invariant
- [ YES ] Click block A's CodeLens — panel A opens.
- [ YES] Click block B's CodeLens — panel A disappears, panel B opens.
- [ YES] Click block B's CodeLens again — panel B disappears (toggle).
- [ YES] Switch to a different editor tab and back — the previously open panel is still open (editor focus doesn't collapse threads).

### Cache persistence
- [YES ] Click any CodeLens. Wait for the explanation to finish.
- [ YES] Reload the window (`Developer: Reload Window`).
- [ YES] Run `CodeWalk: Start Walkthrough` again on the same file.
- [YES ] Click the same CodeLens — panel opens instantly (no spinner, no streaming).

### Cache invalidation
- [ ] Edit `codewalk/prompts/explanation.md` (change a rule). Bump `EXPLANATION_PROMPT_VERSION` in `src/engine/explanationAgent.ts` (e.g. `v1` → `v2`).
- [ ] Rebuild: `cd codewalk && npm run build`.
- [ ] Reload the window. Click the same CodeLens as before — panel re-streams (old `v1` entries dropped on construction).

### Prefetch toggle
- [ ] In Settings UI, enable `codewalk.explanation.prefetchOnSegmentation`.
- [ ] Reload the window. Run `CodeWalk: Start Walkthrough`.
- [ ] Output channel shows `[prefetch]` log lines for each segment.
- [ ] Click any CodeLens — panel opens instantly (prefetched entry).
- [ ] Disable the setting. Reload. Run walkthrough. First clicks stream normally.

### Cancellation during stream
- [YES ] Click a CodeLens. While the summary is still streaming, click a different CodeLens.
- [YES ] The first panel disappears cleanly; the second begins streaming.
- [ YES] No error toast, no stack trace in the Output channel (just `[commentController]` or `[explanation] cancelled` log line).

### Auth-disable prefetch
- [ ] Deliberately set an invalid API key (`CodeWalk: Reset API Key`, re-enter an invalid value via the wizard).
- [ ] Enable prefetch. Run `CodeWalk: Start Walkthrough`.
- [ ] Output channel shows `[prefetch] disabled: auth failed` after the first auth failure.
- [ ] No further `[prefetch] error` lines that session — the queue is quiet.

### Reset cache command
- [YES ] Run `CodeWalk: Reset Explanation Cache` from the Command Palette.
- [YES ] An info message confirms the clear.
- [ YES] Subsequent CodeLens clicks re-stream (no cache hits).

### Backend / model swap
- [ ] Switch `codewalk.backend` from one preset to another (e.g. Groq → Anthropic or vice versa) via the wizard or settings.
- [ ] Click a CodeLens that was previously cached on the old backend — it re-streams (preset component of the cache key differs).

## Open questions
None for Phase 1 closure. Phase 2 spec will open the following:
- Streaming vs. full-response for explanation panels (latency tradeoff).
- Whether/how to expose Anthropic prompt caching through the unified adapter.
- Pre-fetching strategy for adjacent blocks.
- Visual signal for "only one panel open at a time".

## Recent decisions
- **2026-04-20** — **Phase 2b — adaptive kind-aware explanation schema.** Replaced v1 `summary` + PTC arrays with a flat v2 schema: `kind ∈ {trivial, logic, io}` + `purpose` + `flow` + `uses` + `produces` + `watch` + `concepts`. Trivial-difficulty segments short-circuit the LLM (synthesized locally from `segment.oneLiner`) and are pre-populated into the cache at segmentation time. `EXPLANATION_PROMPT_VERSION` bumped v1 → v2; existing `ExplanationStore.rehydrate` sweep evicts v1 entries on first activation. See `docs/superpowers/specs/2026-04-20-codewalk-phase2b-adaptive-explanation.md` and plan in `docs/superpowers/plans/2026-04-20-codewalk-phase2b-adaptive-explanation.md`.
- **2026-04-20** — **Phase 2 brainstorm completed.** Spec drafted at `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md`. Key calls: (1) Full Level 1 scope per design-doc §4.1 — summary + Points to Consider (assumptions, dangers, sideEffects) + tagged Concepts — in one agent call, one schema. (2) Cache keyed `${preset}:${promptVersion}:${segmentId}` and persisted in `ExtensionContext.globalState` — cross-project sharing intentional; content-hash segment ids (ADR-005 addendum) give natural invalidation. (3) Streaming always-on for the `summary` field via a new streaming path on `OpenAICompatibleAdapter`; lists (PTC, concepts) render atomically at stream end. (4) Prefetch opt-in via `codewalk.explanation.prefetchOnSegmentation` (default `false`), session-wide disable on `AuthError`, concurrency 2. (5) `CommentController` with `<details>` Concepts block, re-click-to-toggle, no auto-expand of first block. (6) Stream-idle timeout 60s. (7) One Phase 5 seam preserved: `ExplanationDeps.additionalContext?: string` — always `undefined` in Phase 2.
- **2026-04-20** — **Post-MVP vision doc created.** New `docs/POST_MVP_VISION.md` sibling to `IMPLEMENTATION_PLAN.md`, capturing Phase 5 (Cross-file Intelligence) design in three layers: static dependency graph (tree-sitter, zero LLM cost), symbol-context accumulator (working memory grows as user walks), abnormality detection (prompt-level rule activated when ≥2 sightings exist). Walk-trail + jump-to-definition UX sketched. Rationale: user-raised idea during brainstorm; too large for Phase 2 scope; worth preserving because it's the first feature in the roadmap that's unambiguously agentic rather than LLM-wrapper.
- **2026-04-20** — **Phase 1 smoke-test findings.** Interactive testing against real providers surfaced three bugs that unit tests with mocked fetches couldn't catch: (1) Groq `llama-3.3-70b-versatile` rejects `response_format: {type: "json_schema"}`; (2) Anthropic's OAI-compat endpoint at `https://api.anthropic.com/v1/chat/completions` rejects `{type: "json_object"}` and requires `json_schema`; (3) Anthropic's OAI-compat also rejects requests with only a `system` role message, demanding at least one `user` message. Each provider is "OpenAI-compatible" for different subsets of the spec.
- **2026-04-20** — **`StructuredOutputMode` per preset.** Added `structuredOutputMode: "json_object" | "json_schema"` to `PresetConfig`, threaded through `ResolvedBackend` and `AdapterConfig`. Anthropic → `json_schema`, everyone else → `json_object`. Kept `SEGMENT_JSON_SCHEMA` hardcoded in the adapter for now; proper per-call `jsonSchema` option on `CompleteOptions` deferred to Phase 2 when the explanation agent introduces a second schema. User chose pragmatic ship-working over speculative refactor (would have been -50/+5 lines to drop `response_format` entirely).
- **2026-04-20** — **Prompt role split.** `segmentation.md` is loaded as a single file but split on the `## Input` marker at runtime into `{role: "system", content: rules}` + `{role: "user", content: language/filename/code}`. Anthropic requires a user message; other providers tolerate the split. Retry path preserves the user half unchanged, appends a CRITICAL suffix only to the system half.
- **2026-04-20** — **`codewalk.resetApiKey` command.** Command-palette-accessible way to clear SecretStorage via `setApiKey(context, "")`. Keeps extension users out of Windows Credential Manager / macOS Keychain hunts. Permanent — useful for key rotation, provider switching, debugging.
- **2026-04-20** — **Known follow-up: `NetworkError` logs the full URL including baseUrl in adapter error messages.** If a user mis-pastes a secret into `codewalk.baseUrl`, it will leak into the Output channel (one user did exactly this during smoke testing). Mitigate in Phase 2: redact URL fragments that look like API keys (high-entropy strings, `sk-*`, `gsk_*` prefixes) before appending to `NetworkError` messages.
- **2026-04-17** — MVP decomposed into four per-phase spec → plan → implement cycles. Each phase independently demo-able.
- **2026-04-17** — Persistent memory lives in `CLAUDE.md` + `docs/`, not `.entire/` (which is session telemetry).
- **2026-04-17** — **ADR-001** — Unified `OpenAICompatibleAdapter` replaces the four-adapter design from design-doc §3.5.
- **2026-04-17** — **ADR-002** — Prompts externalized to `prompts/*.md` with a loader; supersedes design-doc §11 partial.
- **2026-04-17** — **ADR-003** — Ollama-local is the shipped default backend; first-run UX specified.
- **2026-04-17** — **ADR-004** — Replaced the "Open Settings" first-run info notification with a multi-step QuickPick wizard. Too-high-friction to ask new users to hand-edit `settings.json`.
- **2026-04-17** — Phase 1 error-handling policy: 2 retries on malformed JSON with stricter retry prompt, then typed error + user-facing message + Output-channel log.
- **2026-04-17** — Developer uses Groq free tier for day-to-day iteration (integrated GPU + 16 GB RAM is too slow for local Ollama); shipped default remains Ollama-local.
- **2026-04-17** — `IMPLEMENTATION_PLAN.md` enriched with per-phase UI/UX intent, risks, and the backend-strategy cross-cutting section. README rewritten with explicit user testing instructions for both backend paths.
- **2026-04-17** — **Segmenter hardening pass** (post-Phase-1, pre-Phase-2). Non-overlap and coverage now enforced in `parseAndValidate`; retries thread the specific validation-failure reason back into the system prompt; segments sorted by `startLine` before id assignment; `SegmenterDeps.logger` surfaces coverage/drop-count to the Output channel; `endLine` clamps to `lineCount` instead of dropping; new `FileTooLargeError` short-circuits oversized files (default 2000 lines) before hitting the LLM. Adds an IoU-based eval harness at `test/eval/segmenterEval.test.ts` gated by `EVAL_SEGMENTER=1` with one seeded golden fixture (`sample.ts`).
- **2026-04-17** — **Cancellation plumbing**. `CancelledError` typed class added to `adapter.ts`; `CompleteOptions.signal?: AbortSignal` added to `LLMAdapter.complete`; `OpenAICompatibleAdapter` converts abort signals to `CancelledError` at fetch and JSON-parse boundaries. `SegmenterDeps.token?: CancellationToken` threads through to the adapter via `toAbortSignal`; synchronous `throwIfCancelled` runs before first attempt and between attempts so a user-cancel during the retry gap doesn't burn the second call. `startWalkthrough` runs `withProgress` with `cancellable: true`; `handleError` treats `CancelledError` as a silent Output-channel log line (no modal, no toast).
- **2026-04-17** — **Content-hash segment ids** (`computeSegmentId` in `segmenter.ts`). Supersedes `seg-${i}`. SHA-256 over `label\0startLine\0endLine\0code` truncated to 12 hex chars, formatted `seg-<hex>`. Stable across identical re-runs (Phase-2 explanation cache will key on this) and change when block content changes (natural cache eviction). Two new tests pin the behavior.
- **2026-04-17** — **API keys moved to SecretStorage**. New `src/utils/secrets.ts` wraps `context.secrets` with `getApiKey` / `setApiKey`. `config.ts.readUserConfig` is now async and takes `ExtensionContext`; it reads the key from SecretStorage rather than `settings.json`. `firstRunWizard` writes via `setApiKey`. `extension.ts` runs `migrateLegacyApiKey` on activation — a one-shot that moves any pre-existing `codewalk.apiKey` out of settings and clears it from all three `ConfigurationTarget` scopes. Existing users see no friction; new users never have a key in `settings.json`.
- **2026-04-17** — **ADR-005 accepted** — formalizes the LLM-call validation contract so Phase 2's explanation agent can mirror it. Seven rules: input guard, parse, per-item validate, cross-item validate, single retry with threaded failure reason, diagnostics via injected logger, eval harness with loose thresholds. Addendum captures cancellation propagation and content-hash identifiers. All 49 unit tests pass.

## Phase 1 → Phase 2 handoff

These pieces are already in place and Phase 2 can build on them without refactoring:

- `codewalk.expandBlock` command registered as a no-op stub — Phase 2 swaps the body.
- `SegmentStore.onDidChange(uri)` broadcasts changes; Phase 2's `CommentController` subscribes as a third listener.
- `SegmentStore.get(uri)` + `segmentId`-keyed lookup — `expandBlock` already receives `segment.id` as its argument.
- All Phase 1 disposables wired into `context.subscriptions`.
- Prompt loader supports arbitrary `.md` files in `codewalk/prompts/` — `explanation.md` just drops in.
- Typed errors cover the paths Phase 2 needs (network, auth, rate-limit, malformed, file-too-large, cancelled).
- **ADR-005 contract** is the template for Phase 2's explanation agent: input guard → parse → per-item validate → cross-item validate → single retry with threaded reason → logger-injected diagnostics → env-gated eval harness. Cancellation token and content-hash ids propagate the same way.
- API keys are in `context.secrets` — any new code reading keys calls `getApiKey(context)`, never `configuration.get("apiKey")`.

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

## What's next

Phase 2c steps 7-12 (Phase 3 nav slice). User-action gate: verify v3 prose output and adjacent-prefetch behavior in Extension Development Host first.

### Phase 2c — verification before continuing

Steps 1-6 are committed on `phase2c-narrative-and-nav`:
1. ✅ Step 1-4 (commit `d8c739f`): v3 schema migration (single-narrative `summary` field; drops `kind`/`purpose`/`flow`/`uses`/`produces`/`watch`/`concepts` and the trivial pre-population eager write).
2. ✅ Step 5-6 (commit `7a451b4`): `PrefetchQueue.enqueueNeighbors` with 200 ms throttle + `prefetchNeighborsOnClick` setting wired into the click path.

### Manual verification checklist (run before steps 7-12)

1. F5 in `codewalk/` to launch Extension Development Host. Open `codewalk/test/fixtures/sample.ts`.
2. Run **Start CodeWalk**. Block labels appear; **no Output channel `[explanation]` lines should fire at this stage** (trivial pre-population is gone).
3. Click any non-trivial CodeLens. Loader animates. Within ~3 s the panel should show a single italic 3–5 sentence prose paragraph — no `Flow` / `Uses` / `Produces` / `Watch` headers, no Concepts dropdown.
4. Click a trivial block (top-of-file imports). Panel opens instantly with the segmenter's one-liner. No spinner, no LLM call (cache miss path triggers click-time `synthesizeTrivial`, no network).
5. Click block 5. Output channel should log `[prefetch]` activity for blocks 4 and 6 within ~200 ms.
6. Click block 4 immediately after — panel should open instantly (prefetched).
7. Run **CodeWalk: Reset Explanation Cache**. Re-click — should re-stream.
8. Reload window with v2 entries in `globalState`. On activation, Output channel should log eviction count > 0; subsequent clicks re-stream against v3 schema.
9. Verify on both Anthropic and Groq presets per ADR-003 dogfood warning.

Steps 7-12 (Phase 3 nav: WalkSession service, Alt+↓/↑/S keybindings, status bar, sidebar TreeView, multi-file queue, docs) start once the above checklist is green.
