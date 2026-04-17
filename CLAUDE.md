# CodeWalk — Session Primer

## Read on session start (in order)
1. `docs/PROJECT_STATE.md` — where we are right now.
2. `docs/IMPLEMENTATION_PLAN.md` — the 4-phase roadmap.
3. `CodeWalk-design-doc.md` — master spec (reference, don't re-read cover-to-cover every session).
4. Latest files under `docs/superpowers/specs/` and `docs/superpowers/plans/` — active phase artifacts.

## Working rules
- **Phase discipline.** One phase in flight at a time. Do not start Phase N+1 before Phase N's demo deliverable works end-to-end.
- **State hygiene.** Update `docs/PROJECT_STATE.md` at every phase boundary and after each numbered step in the active plan.
- **Commit cadence.** Commit at phase boundaries and after each working vertical slice. Commit subjects should reference the phase/step (e.g., "phase1/step3: segmenter returns typed Segment[]").
- **Pace.** Heavy development — the user is moving fast. Don't re-brainstorm what `CodeWalk-design-doc.md` already decides; scope each phase tightly and ship.
- **Design doc authority.** `CodeWalk-design-doc.md` is the master spec. When in doubt, follow it. If a per-phase spec contradicts it, flag the contradiction explicitly before proceeding.
- **`.entire/` is telemetry.** Do not author state there. It is an external session-logging tool; its `metadata/` folder is read-denied.

## File conventions
- Per-phase specs: `docs/superpowers/specs/YYYY-MM-DD-codewalk-phaseN-<topic>.md`
- Per-phase plans: `docs/superpowers/plans/YYYY-MM-DD-codewalk-phaseN-<topic>.md`
- Extension source lives under `codewalk/` (TypeScript + esbuild) per design-doc §11.
