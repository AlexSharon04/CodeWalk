# CodeWalk — Project State

**Last updated:** 2026-04-17
**Current phase:** Phase 1 — Core Loop — **code complete, awaiting manual verification**
**Current step:** All 17 plan tasks landed plus ADR-004 first-run wizard polish. Manual smoke test pending before Phase 2 brainstorm.

## Phase status
- [x] Phase 1 — Core Loop (segmenter + CodeLens + block highlights + first-run wizard) — **code complete 2026-04-17; manual verification pending**
- [ ] Phase 2 — Level 1 Explanations (Comment Controller)
- [ ] Phase 3 — Navigation & File Queue
- [ ] Phase 4 — Level 2 & Polish

## Active artifacts
- Phase 1 spec: `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md` *(approved 2026-04-17)*
- Phase 1 plan: `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md` *(17 tasks, all complete)*
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

### Cloud-API-key path
- [ ] Clear `codewalk.apiKey` in user settings (simulate fresh install).
- [ ] Set `codewalk.backend = "groq"` (or another cloud preset).
- [ ] Run `CodeWalk: Start Walkthrough` → wizard fires.
- [ ] Pick a preset, paste a real API key → walkthrough proceeds without re-running the command.
- [ ] Cancelling the wizard cleanly aborts (no error toast, no partial state).
- [ ] Restart window → wizard does NOT fire (key persisted at Global scope).

### Error-path spot checks
- [ ] With Ollama stopped and `backend = "ollama-local"` + wizard result `ollama-local`: targeted "can't reach Ollama at …" error, not generic network error.
- [ ] Bad API key: `AuthError` path fires "API key rejected" + Open Settings button.
- [ ] `codewalk.showBlockHighlights = false`: tints disappear, CodeLens labels remain.

### Prompt-iteration smoke test
- [ ] Edit `codewalk/prompts/segmentation.md` (e.g., change rule 7 to say 50 chars).
- [ ] Reload Extension Development Host (`Ctrl+R` inside the host window).
- [ ] Re-run Start CodeWalk → new constraint visibly reflected in one-liners.

## Open questions
None for Phase 1 closure. Phase 2 spec will open the following:
- Streaming vs. full-response for explanation panels (latency tradeoff).
- Whether/how to expose Anthropic prompt caching through the unified adapter.
- Pre-fetching strategy for adjacent blocks.
- Visual signal for "only one panel open at a time".

## Recent decisions
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

## What's next
1. **User manually verifies Phase 1** using the checklist above.
2. On pass → commit "phase1/complete: manual verification passed", tag `phase1-complete`.
3. Begin Phase 2 brainstorm (use the `superpowers:brainstorming` skill) — open questions listed above are the starting points.
4. Write Phase 2 spec at `docs/superpowers/specs/YYYY-MM-DD-codewalk-phase2-explanations.md`.
5. On fail → file issues, fix, re-verify, then proceed to step 2.
