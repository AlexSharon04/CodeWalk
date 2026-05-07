# CodeWalk — Project State

**Last updated:** 2026-05-06 (Phase 4 line-by-line landed — MVP feature-complete)
**Current phase:** Phase 2c + Phase 3 nav + Final UX-polish sprint + **Phase 4 line-by-line — all shipped**. The MVP design from `docs/CodeWalk-design-doc.md` is now feature-complete. Phase 5 (cross-file intelligence) remains parked in `docs/POST_MVP_VISION.md`.
**Current branch:** `phase2c-narrative-and-nav` (14+ commits ahead of `phase1-core-loop`)
**Current step:** Branch is ready to merge once manual verification on both Anthropic and Groq presets passes for: Phase 2c+3 nav, the final-sprint UX polish, AND Phase 4 line-by-line. Three checklists below.

## Phase status
- [x] Phase 1 — Core Loop — **code complete 2026-04-17; cloud path verified 2026-04-20 against Anthropic (Claude Sonnet 4.6) and Groq (llama-3.3-70b-versatile)**
- [x] Phase 2 — Level 1 Explanations — **code complete 2026-04-20; superseded by Phase 2b**
- [x] Phase 2b — Adaptive kind-aware schema (kind + purpose + flow + uses + produces + watch + concepts) — **code complete 2026-04-20; superseded by Phase 2c**
- [x] Phase 2c — Single-narrative v3 schema + adjacent prefetch — **code complete 2026-05-06**
- [x] Phase 3 — Navigation & File Queue (folded into Phase 2c slice) — **code complete 2026-05-06**
- [x] Phase 4 — Level 2 & Polish — **code complete 2026-05-06** (line-by-line annotations + HoverProvider + dispose lifecycle; Phase 4 deliverable #4 — difficulty-colored CodeLens — already shipped in the final-sprint commit)

## Active artifacts
- Phase 1 spec: `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md` *(approved 2026-04-17)*
- Phase 1 plan: `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md` *(17 tasks, all complete)*
- Phase 2 spec: `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` *(approved 2026-04-20; plan + implementation complete)*
- Phase 2 plan: `docs/superpowers/plans/2026-04-20-codewalk-phase2-explanations.md` *(14 tasks, all complete)*
- Phase 2b spec: `docs/superpowers/specs/2026-04-20-codewalk-phase2b-adaptive-explanation.md` *(approved 2026-04-20; superseded by Phase 2c)*
- **Phase 2c plan: `docs/superpowers/plans/2026-05-06-codewalk-phase2c-narrative-and-nav.md` *(approved 2026-05-06; all 12 steps complete on `phase2c-narrative-and-nav` branch)***
- **Final-sprint UX-polish plan: `docs/superpowers/plans/2026-05-06-codewalk-final-sprint-ux-polish.md` *(approved 2026-05-06; 6 features shipped)***
- **Phase 4 plan: `docs/superpowers/plans/2026-05-06-codewalk-phase4-line-by-line.md` *(approved 2026-05-06; line-by-line agent + decorator + HoverProvider + toggle command + eval harness shipped)***
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
- **2026-05-06** — **Phase 4 line-by-line annotations shipped.** Closes the original CodeWalk MVP design (design-doc §4.2). Single new agent at `src/engine/lineByLineAgent.ts` following the ADR-005 contract — schema `{ annotations: [{line:int, short:string≤60, full:string}] }`, per-item validation (line in block range, no preamble, length caps), cross-item validation (sorted ascending, no duplicate lines), single-retry. `LineByLineStore` is independent of `ExplanationStore` so each cache invalidates independently and an agent failure can't poison the summary cache. Render uses ONE shared `TextEditorDecorationType` reused across every range (design-doc §12.5 leak guard); per-line `after.contentText` lives on per-range `DecorationOptions`. `HoverProvider` reads the decorator's `Map<uri, Map<line, full>>` for hover bodies — no parallel store. Toggle command on the comment thread title bar (`commentController == codewalk && commentThread == codewalk.thread`). Skipped streaming intentionally — per-line render is hard to stream cleanly and the user's gesture ("show me more depth") tolerates a single ~5–15 s progress-notification wait. Phase 4 deliverable #4 (CodeLens difficulty colors) already shipped in the prior commit. Eval harness env-gated by `EVAL_LINEBYLINE=1` with loose thresholds.
- **2026-05-06** — **Final-sprint UX polish shipped.** End Walkthrough command + dispose lifecycle, sidebar segmentation status icons (✓/spinner/○), background pre-segmentation setting (`codewalk.preSegmentQueuedFiles`, default false), CodeLens difficulty icons, `onDidChangeActiveTextEditor` listener, status-bar visibility one-time hint. New `SegmentationStatusTracker` service is the model for any future "currently doing X" signal — UI-agnostic, just a `Set<string>` + `EventEmitter`.
- **2026-05-06** — **Phase 2c + Phase 3 nav slice shipped.** Twelve-step plan landed in 11 commits on `phase2c-narrative-and-nav`. Highlights: (1) Single-narrative v3 schema replacing the 6-field kind-aware v2 — `summary` only, prose 3–5 sentences, eliminates the broken `<details>` Concepts render and the over-padded watch/produces fields. Net -500 lines on the schema/agent/renderer. (2) Adjacent-block prefetch with 200 ms throttle/merge so rapid Alt+↑/↓ stepping doesn't spawn N cancelled batches. (3) Phase 3 nav in full: `WalkSession` service, Alt+↓/↑/S keybindings, status bar progress indicator, sidebar TreeView with checkbox-toggle queue, cross-file auto-segmentation via shared `segmentFileForWalk` helper. Trivial pre-population (Phase 2b) removed — click-time `synthesizeTrivial` short-circuit kept so trivial blocks still feel instant.
- **2026-05-06** — **Phase 5 `uses`-text-to-link seam dropped.** v3 single-narrative collapses the entire structured schema; `uses: string[]` no longer exists. POST_MVP_VISION.md updated with two paths for the Phase 5 spec to reintroduce structure: (a) add a `references` field alongside `summary`, or (b) inline command-URI links inside the prose. Path (a) is cleaner; (b) is cheaper.
- **2026-05-06** — **Start CodeWalk made queue-aware.** Originally Start CodeWalk only segmented `activeTextEditor.document.uri`, which made multi-file walkthroughs impossible to construct from the sidebar checkboxes (queue formed but never had multiple segmented files). Now: queue takes precedence (segments first un-segmented queued file), falls back to active editor for the single-file demo flow, and surfaces a self-explanatory hint when neither is available. Sidebar gained a Start title-bar button + `viewsWelcome` for discoverability.
- **2026-05-06** — **`vscode-test` runner wedged on Win11 + VS Code 1.119.0.** Fresh-extracted archive triggers VS Code's staged-update false-positive at launch. Code correctness verified via `npx tsc --noEmit` + `npm run build` (both clean) and F5 Extension Development Host. Not a code regression — environment-only. Document so future sessions don't waste time debugging.
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

Phase 2c+3 verification, then Phase 4 (Level 2 line-by-line annotations + polish).

### Phase 2c+3 — committed work

All twelve steps of the Phase 2c plan landed on `phase2c-narrative-and-nav`:

| Step | Commit | Scope |
|---|---|---|
| 1-4 | `d8c739f` | v3 schema migration — single-narrative `summary` field, drop trivial pre-pop, prose prompt |
| 5-6 | `7a451b4` | `PrefetchQueue.enqueueNeighbors` + 200 ms throttle, wired into the click path |
| state | `5c3fccf` | PROJECT_STATE refresh + canonical plan copy |
| 7 | `8e61480` | `WalkSession` service — file queue, active block, `codewalk.active` context key |
| 8 | `aef7543` | `nextBlock` / `prevBlock` / `skipFile` commands + Alt+↓/↑/S keybindings |
| 9 | `b8e3ab0` | Status bar progress indicator with click-to-jump QuickPick |
| 10 | `9bc223d` | Sidebar TreeView ("Walkthrough Files") with checkbox-toggle add/remove |
| 11 | `dbc7a52` | Cross-file auto-segmentation; shared `segmentFileForWalk` helper |
| 12 | (this commit) | Docs |

### Phase 2c+3 manual verification checklist

#### Schema and rendering (Phase 2c)

1. F5 in `codewalk/` to launch Extension Development Host. Open `codewalk/test/fixtures/sample.ts`.
2. Run **Start CodeWalk**. Block labels appear; the CodeWalk activity-bar icon shows up.
3. Click any non-trivial CodeLens. Loader animates with elapsed counter. Within ~3 s the panel shows a single 3–5 sentence prose paragraph — no `Flow` / `Uses` / `Produces` / `Watch` headers, no Concepts dropdown.
4. Click a trivial block (imports). Panel opens instantly with the segmenter's one-liner. No spinner, no LLM call.
5. Click block 5. Output channel should log `[prefetch]` activity for blocks 4 and 6 within ~200 ms.
6. Click block 4 — opens instantly (prefetched).
7. Run **CodeWalk: Reset Explanation Cache** — re-clicks re-stream.
8. Reload window with v2 entries in `globalState`. Output channel logs eviction count > 0; subsequent clicks re-stream against v3.

#### Navigation (Phase 3)

9. After Start CodeWalk, the **status bar** at bottom-left reads `$(book) CodeWalk: File 1/1 | Block —/N`.
10. Click any block — status bar updates to `Block X/N`.
11. Press **Alt+↓** — cursor jumps to next block, panel expands. Status bar updates.
12. Press **Alt+↑** — cursor returns to previous block.
13. Press **Alt+↑/↓** at file boundaries with no other queued file — info toast surfaces, no error.
14. Open the **CodeWalk activity bar** (book icon). The "Walkthrough Files" tree shows workspace files; the active file is checked.
15. Check a second file in the sidebar. Press **Alt+↓** repeatedly through the active file. At the last block, Alt+↓ kicks off a "CodeWalk: Analyzing <new file>…" progress notification, then jumps into the first block of the new file.
16. Press **Alt+S** mid-file — the file is dropped from the queue; nav advances to the next file.
17. Click the status bar item — a QuickPick lists every analyzed block in the active file with label / one-liner / line range / difficulty. Picking one jumps + expands.
18. Verify **Move Line Up/Down** still works in plain editor focus when CodeWalk is inactive (no file queued / no segments computed).

#### Backends

19. Verify the full flow once on Anthropic and once on Groq per ADR-003 dogfood warning.

### Late-session fixes (2026-05-06)

Two issues surfaced once the user F5-tested the Phase 3 nav slice. Both are fixed on the same branch:

| Commit | Bug | Fix |
|---|---|---|
| `f32ff56` | Alt+S to a queued-but-unsegmented next file collapsed to "walkthrough complete" | `firstBlockOfActive` returns a placeholder NavTarget (segmentId="") matching `computeStep`'s shape; blockNav's existing placeholder branch triggers segmentation and lands the user. Toast also distinguishes "only file in queue → check more in the sidebar" from "true end of walkthrough." |
| `e76892d` | Start CodeWalk only segmented `vscode.window.activeTextEditor`, ignoring sidebar checkboxes — so multi-file queues never formed naturally and Alt+S had nothing to advance to | Start CodeWalk now consults `WalkSession.fileQueue` first; segments the first un-segmented queued file; falls back to the active editor when the queue is empty. Sidebar gains a Start CodeWalk title-bar action and a `viewsWelcome` empty-state hint teaching the workflow. |

### Final-sprint shipped (2026-05-06)

UX polish + dispose lifecycle landed on `phase2c-narrative-and-nav`. Plan: `docs/superpowers/plans/2026-05-06-codewalk-final-sprint-ux-polish.md`.

| # | Scope | Files touched |
|---|---|---|
| 1 | **End walkthrough command + dispose lifecycle.** New `codewalk.endWalkthrough` command, palette + sidebar title-bar action gated on `codewalk.active`. Collapses open thread, calls new `SegmentStore.clearAll()` so decorations + CodeLenses vanish, calls `walkSession.end()`. `ExplanationStore` cache survives — re-running Start CodeWalk keeps prior explanations warm. | `extension.ts`, `engine/segmentStore.ts`, `package.json` |
| 2 | **Difficulty colors on CodeLens labels.** ThemeIcon prefix per difficulty: `$(circle-outline)` trivial, `$(circle-filled)` standard, `$(warning)` complex, `$(error)` critical. Theme-aware via VS Code's built-in icon foreground colors. (Phase 4 deliverable #4 from `IMPLEMENTATION_PLAN.md`.) | `providers/codeLensProvider.ts` |
| 3 | **`onDidChangeActiveTextEditor` listener.** When walkthrough is active and the user clicks into a queued file's tab, `walkSession.setActive(uri, undefined)` so status bar follows focus. No auto-add for non-queued files. | `extension.ts` |
| 4 | **Sidebar segmentation status indicator.** New `SegmentationStatusTracker` service publishes a "currently segmenting" set; `FileQueueProvider` listens and renders `loading~spin` / `check` / `circle-outline` icons per row. Tracker is bracketed around every `segmentFileForWalk` call. | `services/segmentationStatusTracker.ts`, `views/fileQueueProvider.ts`, `commands/segmentFile.ts`, `commands/startWalkthrough.ts`, `commands/blockNav.ts`, `extension.ts` |
| 5 | **Background pre-segmentation setting.** `codewalk.preSegmentQueuedFiles` (default `false`). After Start CodeWalk segments the first file, fire-and-forget loop hits `segmentFileForWalk(uri, { silent: true, tracker })` for each remaining un-segmented file in the queue. `silent` switches the progress location from Notification to Window so the user doesn't get spammed. Stops if walkthrough ends mid-loop. | `commands/startWalkthrough.ts`, `commands/segmentFile.ts`, `package.json` |
| 6 | **Status bar visibility one-time hint.** First time `codewalk.active` becomes true, a one-shot toast tells the user where progress shows up. Gated by `globalState.get("codewalk.statusBarHintShown")`. | `extension.ts` |
| 7 | **Tests for `clearAll` + `SegmentationStatusTracker`.** Unit-level coverage; integration verified via `tsc --noEmit` + `npm run build` + F5 EDH per `project_vscode_test_wedge.md` workflow. | `test/suite/segmentStore.test.ts`, `test/suite/segmentationStatusTracker.test.ts` |

Out of scope (deferred to next sprint): **Phase 4 line-by-line annotations** — `prompts/lineByLine.md` agent + ADR-005 contract + `after.contentText` decorations + HoverProvider + comment-thread title button + eval harness. Bundling those with this UX sprint would have risked shipping nothing well.

### Final-sprint manual verification checklist

1. **End walkthrough.** Start CodeWalk on `sample.ts`. Click a CodeLens. Run **CodeWalk: End Walkthrough** from the palette OR click the `$(close)` icon in the sidebar title. Verify: open thread collapses, decorations + CodeLenses vanish, status bar hides, sidebar checkboxes clear (no segmented files left), `codewalk.active` flips off (Alt+↓ falls through to Move Line Down).
2. **Sidebar segmentation status.** Check 3 files in the sidebar. Run Start CodeWalk. While segmentation is in flight, that file's row shows the spinner; once done, ✓. The other 2 rows show ○. Toggle `codewalk.preSegmentQueuedFiles = true`, reload, repeat — files 2 and 3 cycle ○ → spinner → ✓ in the background while you read file 1.
3. **Active-editor listener.** Mid-walkthrough, switch to a different queued file via Ctrl+Click in the explorer (don't trigger a CodeLens). Status bar updates to show the new file index; block index resets to "—".
4. **Difficulty colors on CodeLens.** Open `test/fixtures/sample.ts`. Verify each difficulty shows its distinct icon (○ trivial, ● standard, ⚠ complex, ✕ critical). Switch to a light theme, verify icons remain visible.
5. **Status bar hint.** First time CodeWalk activates a walkthrough on this profile, a one-time toast fires. Run Start CodeWalk again — no toast. Reload window — no toast.
6. **No regressions.** Phase 2c+3 manual checklist (above) still passes.

### Phase 4 — line-by-line annotations (shipped 2026-05-06)

The last MVP-vision feature. Plan: `docs/superpowers/plans/2026-05-06-codewalk-phase4-line-by-line.md`.

| Component | File(s) |
|---|---|
| `LineAnnotation` + `LineByLine` types | `src/types/index.ts` |
| `prompts/lineByLine.md` | `prompts/lineByLine.md` |
| ADR-005-compliant agent (`annotate`, `LineByLineTooLargeError`, `LINE_BY_LINE_PROMPT_VERSION = "v1"`, schema, per-item + cross-item validation, single retry) | `src/engine/lineByLineAgent.ts` |
| `LineByLineStore` (mirrors `ExplanationStore`; key prefix `lineByLine:`; version-gated rehydrate sweep) | `src/engine/lineByLineStore.ts` |
| `LineByLineDecorator` — **ONE** `TextEditorDecorationType` reused across all ranges per design-doc §12.5; per-line `after.contentText` carried by `DecorationOptions.renderOptions` | `src/editor/lineByLineDecorator.ts` |
| `LineByLineHoverProvider` — `Map<uri, Map<line, full>>` lookup via the decorator | `src/providers/lineByLineHoverProvider.ts` |
| `codewalk.toggleLineByLine` command + comment-thread title-bar contribution gated on `commentThread == codewalk.thread` | `src/commands/toggleLineByLine.ts`, `src/extension.ts`, `package.json` |
| `codewalk.resetLineByLineCache` palette command | `src/extension.ts`, `package.json` |
| End Walkthrough now also runs `lineByLineDecorator.clearAll()` | `src/extension.ts` |
| Eval harness gated by `EVAL_LINEBYLINE=1` (≥30% line coverage, ≤60-char shorts, sorted, no duplicates) | `test/eval/lineByLineEval.test.ts` |
| Unit tests for agent, store, decorator | `test/suite/lineByLineAgent.test.ts`, `test/suite/lineByLineStore.test.ts`, `test/suite/lineByLineDecorator.test.ts` |

### Phase 4 manual verification checklist

1. F5 in `codewalk/`. Open `codewalk/test/fixtures/sample.ts`.
2. Run **Start CodeWalk**. Click any non-trivial CodeLens — the existing summary panel opens.
3. The panel's title bar shows a new **inline `$(list-tree)` button** (CodeWalk: Toggle Line-by-Line).
4. Click it. Progress notification: `CodeWalk: line-by-line annotations…`.
5. Within ~5–15 s (depending on backend), inline grey italic annotations appear next to non-obvious lines: `  ⟵ <short>`. The summary panel itself is unchanged.
6. Hover any annotated line. A markdown tooltip appears with the full body.
7. Hover a non-annotated line. **No tooltip** (provider returns undefined).
8. Click the toggle button again. Annotations **disappear**.
9. Click again — they re-apply **instantly** (cache hit).
10. Run **CodeWalk: End Walkthrough**. All decorations vanish (block highlights AND line-by-line). Sidebar checkboxes clear, status bar hides.
11. Run **CodeWalk: Reset Line-by-Line Cache** — re-toggling re-streams.
12. On a 200+ line block: toggle fires `LineByLineTooLargeError` toast; no hang.
13. On a freshly-edited block (segmenter re-runs → new segmentId): line-by-line cache misses, refetches.

Build verification: `cd codewalk && npx tsc --noEmit && npm run build && npm run compile-tests` — all clean. F5 EDH for the manual checklist.

### Followups

- **Phase 5 — Cross-file intelligence.** Spec parked in `docs/POST_MVP_VISION.md`. Phase 4's `full` markdown bodies are the natural seam for command-URI links to jump-to-definition once Phase 5 lands.
- **Edit-aware annotation invalidation.** When the user edits the file, line numbers drift and decorations sit on the wrong line. Same fragility as the existing block highlights. Defer until users complain.
- **Per-file dispose policy revisit.** UX call still pending — current behavior keeps decorations as breadcrumbs.

#### Phase 4 — Level 2 & polish (per `docs/IMPLEMENTATION_PLAN.md` §Phase 4)

1. **"Show Line-by-Line" button** on the comment thread title bar via `CommentThread.contextValue` + a menu contribution. Opt-in only — block-level Level 1 panels stay the default.
2. **Per-line `after.contentText` decorations.** ONE `TextEditorDecorationType` reused across lines (per-line types are the #1 leak in VS Code extensions — design-doc §12.5). Annotation source is a new agent prompt at `prompts/lineByLine.md` following the ADR-005 contract.
3. **`HoverProvider`** bound to the same per-line ranges, returning the full per-line story. Markdown body, no command-URI links yet.
4. **Difficulty colors on CodeLens labels themselves** (currently only on backgrounds). Match the four `BlockHighlighter` colors via themed title strings; verify on both light and dark themes.
5. **Full dispose lifecycle on walkthrough end.** A new `codewalk.endWalkthrough` command + `WalkSession.end()` now exists but isn't bound to a clean dispose-everything path — Phase 4 wires the session-scoped object that owns transient state (decorations, threads, status bar item visibility, sidebar reset).

#### UX backlog from 2026-05-06 user testing

These came up while smoke-testing Phase 2c+3. Phase 4 sprint should fold them in.

- **Background pre-segmentation** of all checked sidebar files. New setting `codewalk.preSegmentQueuedFiles` (default `false`). When `true`, after the first file finishes segmenting, fire `segmentFileForWalk` for the rest of the queue in fire-and-forget mode (no progress notification — pipe to a non-modal status-bar spinner). User explicitly raised "while the user is looking at the code, the LLM is generating in the background" as desired behavior.
- **Sidebar segmentation status indicator.** Each row in the file-queue tree shows whether the file is segmented (✓), in-progress (spinner via `ThemeIcon("loading~spin")`), or unsegmented (○). Currently the checkbox tells you only "in queue or not" — segmentation status is invisible.
- **End walkthrough command.** Bind `codewalk.endWalkthrough` to a sidebar title action and the command palette so users can cleanly exit the walkthrough state (`codewalk.active = false`, decorations disposed, status bar hidden, queue cleared optionally).
- **`onDidChangeActiveTextEditor` listener** that calls `walkSession.setActive(uri, undefined)` when the user manually clicks into a different editor tab whose URI is already in the queue. The status bar would then track the user's actual focus instead of waiting for a CodeLens click.
- **Status bar default-on hint.** First-run, if `codewalk.active` becomes true while the status bar is hidden in workbench settings, surface a one-time toast "CodeWalk shows progress in the status bar — enable via View → Appearance → Show Status Bar." User got bitten by a hidden status bar this session.
- **Per-file dispose policy revisit.** Original Phase 3 spec said "dispose previous file's threads + decorations on advance." Current implementation keeps decorations as breadcrumbs (so Alt+↑ can navigate back without re-segmenting). Either re-confirm the breadcrumbs decision or wire dispose-on-advance — needs a UX call from the user.

#### Verification

Manual checklist for Phase 2c+3 above is the regression bar. Phase 4 will append its own checklist (line-by-line render, hover content, decoration-leak smoke test on a 500-line file, dispose verification on End Walkthrough).

#### Known environmental issue

`vscode-test` runner is wedged on this Win11 machine (VS Code 1.119.0 staged-update false-positive on fresh-extracted archives). `npx tsc --noEmit` and `npm run build` both run clean — code correctness is verifiable without the launcher. F5 Extension Development Host works for manual testing.
