# Phase 2 — Explanation Schema Brainstorm (preserved verbatim)

**Date.** 2026-04-20
**Status.** Preserved reference — do NOT edit the verbatim block below.
**Scope.** Captures the brainstorming output that shaped the Phase 2 `Explanation` schema redesign (shape-stable, `kind`-tagged) AND the Phase 5 "blocks reference each other" walk-trail vision.
**Purpose.** The user explicitly asked that this reasoning be saved unchanged so the vision comes to fruition. It informs both:
- The current Phase 2 adaptive-explanation work — `kind`-discriminated fields, `purpose` / `flow` / `uses` / `produces` / `watch` capped arrays, collapsed PTC.
- The Phase 5 cross-file intelligence design — specifically the bet that `uses: string[]` is plain text in Phase 2 and becomes clickable links in Phase 5 with zero schema change.

**Related.**
- `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` — the in-flight Phase 2 spec this brainstorm feeds into.
- `docs/POST_MVP_VISION.md` — Phase 5 (Cross-file Intelligence) is where the walk-trail / symbol-context-accumulator ideas below will land.
- `docs/ARCHITECTURE_DECISIONS.md` — ADR-005 (the validation contract any new `Explanation` schema must still satisfy).

**Do not modify the verbatim section.** Corrections, counter-arguments, or schema drift should go in a new follow-up doc that links back here.

---

## Verbatim brainstorm output

> Great, that's a rich prompt and I want to play it out before we land on fields.
>
> `★ Insight ─────────────────────────────────────`
> - Runtime is dominated by output tokens, not input. Adding MORE fields can still be FASTER if each field has a tight cap, because we kill the "pad to middle of 0–5" inflation that currently costs 60–70% of the response length.
> - The segmenter already produces difficulty and oneLiner per block — the explanation agent currently ignores both. If we feed difficulty back in as a prompt constraint ("this block is trivial — emit only what's necessary"), we get adaptiveness almost for free.
> - Your cross-block-linking idea lives in Phase 5 territory (POST_MVP_VISION.md — walk-trail + symbol-context accumulator). We already have the seam (ExplanationDeps.additionalContext). I'll show you how to get 80% of the feel now without opening Phase 5.
> `─────────────────────────────────────────────────`
>
> ### Playing the role of a programmer reading an unfamiliar block
>
> If I drop into a file cold and hit a block, here's what I actually want — in order of what I reach for first:
>
> **For a function-definition block:**
> - **Signature** — `fn(name: string, opts: Options) → Promise<User>`. Types tell me 80% of what the function does before I read one line.
> - **Purpose** — one sentence. What's the why.
> - **Flow** — 2–4 terse bullets of logical steps, NOT line-by-line: validate → fetch from DB → shape response. Entry-level devs trace steps, not lines.
> - **Uses** — what this block leans on: `db.users`, `bcrypt.compare`, `req.session`. The "what else do I need to go read" list.
> - **Produces** — what gets returned / mutated / emitted. If it's a side-effect function, what changes in the world.
> - **Watch** — 0–3 specific concerns (not 3 always). Merged assumptions + dangers + sideEffects into one list because the split is a distinction the model doesn't respect anyway.
>
> **For an I/O block (the thing you specifically called out — networking / DB):**
> - **Kind tag** — `network | database | filesystem | external-api`
> - **Touches** — concrete endpoint: `POST /users`, `users` table, `fs.readFile("./config.json")`. Specific, not abstract.
> - **Data shape** — what goes over the wire / into the query: `{email, pw} → User row`
> - **Failure mode** — timeout? 404? stale cache? The failure-shape matters more than the happy path here.
>
> **For a validation/guard block:**
> - **Checks** — what's enforced: `req.body.email` is string, non-empty
> - **On fail** — throws `ValidationError`, returns 400, silently skips?
> - Often 3–5 lines of code, needs 50 words of explanation. This is where current output is maximally padded.
>
> **For a control-flow block (switch/match/if-ladder):**
> - **Decides on** — `user.role`
> - **Branches** — one line each: `admin → grants`, `guest → redirects`, `else → 403`
>
> **For a config/boilerplate block:**
> - Just the kind tag + one sentence. No "watch", no concepts. If there are 12 imports, nobody wants 3 dangers about imports.
>
> **For a class/type definition:**
> - **Role** — data model, service, adapter, value object
> - **State** — key fields and what they hold
> - **Entry points** — which methods callers actually use
>
> ### What I'm hearing for the schema direction
>
> A shape-stable schema with `kind` as the first-class tag, where most fields are optional arrays and the prompt instructs "emit empty for irrelevant kinds":
>
> ```ts
> {
>   kind: "function" | "io" | "validation" | "control-flow" | "config" | "boilerplate" | "class" | "logic-other",
>   signature?: string,            // function-kind only
>   purpose: string,               // always, 1-2 sentences max
>   flow: string[],                // 0-5 logical steps
>   uses: string[],                // 0-5 symbols/modules this leans on
>   produces: string[],            // 0-3 outputs/effects
>   watch: string[],               // 0-3 specific concerns (merged PTC)
>   concepts: Concept[],           // 0-3, unchanged contract
> }
> ```
>
> Key differences from today:
> - `summary` → `purpose` (tighter, capped at 2 sentences; no "2–4 sentences" rule)
> - 3 PTC arrays collapse to one `watch` capped at 0–3 (this kills the "2 lines / 3 dangers" failure mode directly)
> - `kind` drives the prompt's per-kind instructions
> - New `flow` + `uses` + `produces` carry the programmer-bullet value you described
>
> Net volume: roughly the same as today for logic blocks, 60–70% smaller for trivial blocks. Latency scales with volume.
>
> ### On the cross-block navigation idea — I want to address this directly
>
> You're describing something real and powerful, but it's genuinely Phase 5:
>
> - "Blocks learning from each other" = the symbol-context accumulator in POST_MVP_VISION.md. Agent sees "this block calls `validateEmail` — here's what we already learned about `validateEmail` three blocks back."
> - "UI/UX arrows to jump around saved codeblocks" = the walk-trail UI. Needs Phase 3 (navigation) to land first for the substrate.
>
> If we try to build this now, we're simultaneously in Phase 2, 3, and 5. That's exactly the "phase discipline" rule in CLAUDE.md warning against.
>
> **But there's a cheap 80%-solution we can do in this brainstorm's scope:** the `uses` field is a text mention of related symbols. In the rendered panel, these appear as plain strings today. When Phase 5 lands, those exact strings become clickable links — zero schema change, zero re-explanation. We get the "blocks reference each other" feel now with text, and the arrows light up for free later.
>
> On "more powerful than cloning and skimming" — I'd argue the path to that strength is:
> 1. **Per-block density** (this brainstorm): bullet-oriented, kind-aware, adaptive — so a dev reads 30 seconds of explanation and knows more than 3 minutes of skimming would give them.
> 2. **Phase 3 navigation**: jump between blocks with hotkeys + a file queue.
> 3. **Phase 5 cross-references**: the arrows and walk-trail.
>
> Each phase independently makes CodeWalk beat skimming for a specific reason. Doing them in order means each ships working, rather than half of all three.

---

## How this doc is referenced

- The Phase 2 spec (`2026-04-20-codewalk-phase2-explanations.md`) links here from its "Future work" / schema-redesign section.
- `POST_MVP_VISION.md` Phase 5 (Cross-file Intelligence) links here from its "Referenced brainstorms" subsection, specifically flagging the `uses` field text-to-link progression and the walk-trail rationale.

Before Phase 5 work kicks off: re-read the verbatim section above. The "blocks learning from each other" framing and the text-to-link bet should drive Phase 5 spec choices.
