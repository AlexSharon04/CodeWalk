# CodeWalk — Project State

**Last updated:** 2026-04-17
**Current phase:** Phase 1 — Core Loop
**Current step:** Phase 1 plan drafted. Ready to begin execution (17 tasks).

## Phase status
- [ ] Phase 1 — Core Loop (segmenter + CodeLens + block highlights) — **spec approved, plan ready for execution**
- [ ] Phase 2 — Level 1 Explanations (Comment Controller)
- [ ] Phase 3 — Navigation & File Queue
- [ ] Phase 4 — Level 2 & Polish

## Active artifacts
- Phase 1 spec: `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md` *(approved 2026-04-17)*
- Phase 1 plan: `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md` *(17 tasks, awaiting execution)*
- ADRs: `docs/ARCHITECTURE_DECISIONS.md` *(ADR-001, ADR-002, ADR-003 accepted)*

## Open questions
None currently — Phase 1 spec is complete. Next questions arrive when writing the Phase 2 spec (e.g., how to visually signal "only one panel open at a time"; styling of concept badges).

## Recent decisions
- **2026-04-17** — MVP decomposed into four per-phase spec → plan → implement cycles. Each phase independently demo-able.
- **2026-04-17** — Persistent memory lives in `CLAUDE.md` + `docs/`, not `.entire/` (which is session telemetry).
- **2026-04-17** — **ADR-001** — Unified `OpenAICompatibleAdapter` replaces the four-adapter design from design-doc §3.5.
- **2026-04-17** — **ADR-002** — Prompts externalized to `prompts/*.md` with a loader; supersedes design-doc §11 partial.
- **2026-04-17** — **ADR-003** — Ollama-local is the shipped default backend; first-run UX specified.
- **2026-04-17** — Phase 1 error-handling policy: 2 retries on malformed JSON with stricter retry prompt, then typed error + user-facing message + Output-channel log.
- **2026-04-17** — Developer uses Groq free tier for day-to-day iteration (integrated GPU + 16 GB RAM is too slow for local Ollama); shipped default remains Ollama-local.

## What's next
1. Choose execution mode: subagent-driven (fresh subagent per task — recommended for isolation and speed) or inline (this session, with batch checkpoints).
2. Execute Tasks 1–17 from `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md`.
3. Update this file at each phase-step boundary; mark the phase complete at Task 17.
4. Tag `phase1-complete` and begin Phase 2 brainstorming.
