# CodeWalk — Post-MVP Vision

This document is a sibling to `IMPLEMENTATION_PLAN.md`. The latter is the committed roadmap for the MVP (Phases 1–4, each a demo-able slice). This doc captures features that would extend CodeWalk beyond the class-project MVP — ideas worth preserving, shaped enough to build later, explicitly NOT in flight.

Nothing in this document is authoritative until it's promoted into `IMPLEMENTATION_PLAN.md` as a new phase. Treat these as scoped-out notes.

---

## Phase 5 — Cross-file Intelligence

**Goal.** CodeWalk stops being a per-file agent and starts accumulating understanding across the files a user walks through. As the user navigates, the agent's working memory grows; each explanation becomes richer than the last. Cross-file abnormalities (inconsistent symbol usage, call-sites missing error handling their siblings have, dead code) surface naturally as the user encounters them.

This is the first feature in the CodeWalk roadmap that is unambiguously agentic — the agent plans, acts, remembers, and adjusts its future output based on prior observations. Phases 1–4 are LLM-driven features; Phase 5 is an agent.

**User story.** The user runs `CodeWalk: Start Walkthrough` on `routes/api.ts`. They click into `handleLogin`, which calls `validateJWT` imported from `auth/middleware.ts`. The explanation panel shows a compact `Referenced elsewhere` section listing `validateJWT — defined in auth/middleware.ts:42`. Clicking it opens `auth/middleware.ts`, jumps to that segment, and auto-expands its explanation. The user reads it, then presses `Alt+Left` to return to `api.ts`. The original panel now shows an addendum: *"You've now seen validateJWT's definition. Based on that, note that this caller passes `req.body.token` directly, which assumes the body parser has already run — validateJWT does not parse, it only verifies."* The walk-trail breadcrumb in the status bar reads `api.ts:handleLogin → auth/middleware.ts:validateJWT`. Three blocks later, CodeWalk flags a danger: *"This is the third place the codebase validates JWTs. The other two (auth/middleware.ts:42, auth/refresh.ts:88) both catch `TokenExpiredError` explicitly; this one doesn't — an expired token here throws unhandled."*

### Layer 1 — Static dependency graph

**What it is.** A tree-sitter or TS-compiler-API pass that extracts, per file in the walkthrough:
- Exports (names, kinds: function/class/type/const/default)
- Imports (local path, imported names)
- Top-level symbol definitions with their line range
- Call-site references to symbols that resolve to other files in the walkthrough

Result: `Map<string symbol, {definedIn: Location, references: Location[], kind: SymbolKind}>`.

**How it's built.** Runs once per session per file, synchronously with segmentation (or parallel to it). Cached by file content hash — re-opening a file the user walked through previously is free. Incremental on file edits (VS Code's `onDidChangeTextDocument` invalidates just that file's contribution).

**Cost.** Zero LLM calls. One tree-sitter parse per file, cached. For a 50-file walkthrough: < 1 second total on a modern machine.

**Supported languages.** Whichever languages have tree-sitter grammars ready in the extension host. TypeScript, JavaScript, Python, Go, Rust, Java cover the common cases. Unsupported languages degrade gracefully: the file's segments render without cross-file annotations; no errors.

### Layer 2 — Symbol-context accumulator

**What it is.** A new store, `SymbolContextStore`, that grows as the user walks. It holds, per symbol:
```ts
interface SymbolContext {
  symbolName: string;
  sightings: Array<{
    segmentId: string;
    fileUri: Uri;
    role: "definition" | "usage";
    explanationSummary: string;   // cached from the explanation agent
  }>;
  lastSeen: Date;
}
```

**How it grows.** After the explanation agent completes for a segment:
1. Layer-1's dep graph is queried for symbols this segment defines or prominently uses.
2. Each such symbol is upserted into `SymbolContextStore`, with `role` derived from whether the segment contains the definition or a reference.
3. The segment's `explanationSummary` is attached to the sighting.

**How it's injected.** When the explanation agent runs on a NEW segment, it queries the store for any referenced symbols that already have sightings. Matching entries are formatted into the `additionalContext` slot (the Phase 2 hook) of the prompt:

```
Prior context — the user has already walked through these symbols:

- validateJWT (defined in auth/middleware.ts, lines 40-55):
  "Verifies a JWT by checking signature against process.env.JWT_SECRET and
  validating standard claims. Assumes HS256; rejects other algorithms."

- parseBody (defined in http/parser.ts, lines 12-28):
  "Parses and validates an incoming request body as JSON, returning a
  typed result or throwing MalformedBodyError."

Use this prior context to produce a specific explanation — reference the
prior sightings where relevant ("this calls validateJWT, which you saw
earlier ..."), and flag any inconsistencies between usages.
```

**Invalidation.** A sighting expires when its `fileUri`'s file hash changes (file was edited since the sighting was recorded). Stale sightings are dropped lazily on next query.

### Layer 3 — Abnormality detection

**What it is.** When a symbol has ≥ 2 recorded sightings, the explanation agent's prompt grows a new rule: *"If the current usage differs materially from prior sightings — different argument shapes, missing error handling present elsewhere, different assumed state — flag it explicitly in Points to Consider → dangers."*

**How it works.** Purely prompt-level. No new infrastructure. The rule only activates when `additionalContext` contains ≥ 2 sightings of the current segment's symbols. The agent does the differential reasoning itself.

**Why it's valuable.** Catches the class of bugs that are invisible file-by-file but obvious when you've seen the codebase's own conventions: "all other call sites of this function catch `SomeError`; this one doesn't." Real, teachable, and only possible because the agent has accumulated prior context.

### UX — walk trail and jump-to-definition

**In the explanation panel.** A new section beneath Points to Consider, rendered inline:

```markdown
### Referenced elsewhere
- [validateJWT](command:codewalk.walkToSymbol?%5B%22validateJWT%22%5D) — defined in `auth/middleware.ts:42`
- [parseBody](command:codewalk.walkToSymbol?%5B%22parseBody%22%5D) — defined in `http/parser.ts:12`
```

`codewalk.walkToSymbol` is a new command. It:
1. Opens the defining file in the editor.
2. Jumps to the defining segment's range.
3. Auto-expands that segment's explanation (the one-time-we-auto-expand case — justified because it's the user's explicit request).
4. Pushes the source segment onto a walk-trail stack.

**In the status bar.** Below the existing Phase 3 progress indicator, a breadcrumb showing the walk trail:

```
CodeWalk: api.ts:handleLogin → auth/middleware.ts:validateJWT
```

Clicking the breadcrumb shows the full trail. `Alt+Left` pops the trail and returns to the previous location. When the user pops back, the original segment's panel re-renders with an addendum produced by a follow-up agent call: *"You've now seen `validateJWT`'s definition. Based on that, here's what this call site specifically assumes …"* The addendum is cached like a regular explanation (key includes the set of symbol sightings at the time of generation, so it refreshes when new context accumulates).

### Phase 2 preservation

Phase 2 leaves one hook for Phase 5 — `ExplanationDeps.additionalContext?: string` — which is always `undefined` in Phase 2/2b/2c. Phase 5 fills it from `SymbolContextStore`. No other surface changes for Phase 5 readiness.

**Update 2026-05-06 — `uses`-seam dropped.** The `uses: string[]` text-to-link seam from the original Phase 2 design no longer exists. Phase 2c collapsed the explanation schema to a single `summary` string (3–5 sentences), dropping the `kind` / `purpose` / `flow` / `uses` / `produces` / `watch` / `concepts` fields entirely. Phase 5 must reintroduce structure to support clickable cross-file references. Two paths to consider:

- **(a) Add back a structured `references` field** alongside `summary` (`{summary: string, references?: Reference[]}`), populated by the Phase 5 prompt when the symbol-context accumulator has prior sightings. This keeps Phase 2c's prose-first UX as the default and turns on structure only when there's something cross-file to surface.
- **(b) Inline command-URI links inside the prose `summary`** so the LLM is responsible for emitting `[validateJWT](command:codewalk.walkToSymbol?…)` directly. Lower schema change, but the LLM has to escape command URIs correctly and Phase 2c's preamble/fence validation rules need a carve-out.

(a) is cleaner; (b) is cheaper to ship. The Phase 5 spec should pick one and document the trade.

### Referenced brainstorms

- [`docs/superpowers/specs/2026-04-20-codewalk-phase2-explanation-schema-brainstorm.md`](superpowers/specs/2026-04-20-codewalk-phase2-explanation-schema-brainstorm.md) — preserves the 2026-04-20 reasoning that established the "blocks learning from each other" vision, the walk-trail UX rationale, and the `uses`-field text-to-link bet. Re-read before opening a Phase 5 spec.

### Open questions for Phase 5 spec

- **When to regenerate vs append.** When the user returns from a jump, does the original explanation regenerate from scratch with the richer context, or does an addendum get appended? Trade-off: regeneration feels seamless but costs an LLM call each return; appendage is cheaper but visually noisier.
- **Dead-code detection.** Layer 1 has `references: Location[]`. If `references.length === 0` for an exported symbol, the agent could flag `"this export is never imported anywhere in the current walkthrough"`. Low-confidence signal (the user may have selected a subset of files), but potentially valuable.
- **Context size budget.** If a user walks a large repo, `SymbolContextStore` grows unbounded. Cap at top-K most-recently-seen symbols per prompt. Value of K TBD by prompt-token economics.
- **Tree-sitter vs TS-compiler-API.** TS gets better resolution via the compiler API; other languages only have tree-sitter. Mixed-language codebases may want both paths. Decide per-file in the dep-graph module.

### Why not Option B (LLM-generated repo index)

An earlier design considered pre-generating summaries for every file at walkthrough start via a second LLM pass. Layer 1 + Layer 2 above is preferable because:
- Progressive: the system earns its richness through user action, not upfront cost.
- Deterministic: static analysis makes the cross-file signal explainable. An LLM-generated repo summary can hallucinate dependencies that don't exist.
- Cheaper: zero up-front LLM cost. The agentic feeling comes from the accumulator, not from pre-indexing.

LLM-generated repo indexing could still ship later as an *optional* "deep analysis" mode alongside Phases 5's static-first default.

---

## Other post-MVP ideas (placeholder)

- **Walkthrough summary screen** at completion (design-doc §6 mentions).
- **Sandbox execution** to verify explanations (design-doc §6).
- **Export walkthrough as structured Markdown** (design-doc §6).
- **Difficulty-based filtering** — show only `complex`/`critical` blocks (design-doc §6).
- **Custom segmentation rules per language** (design-doc §6).
- **Shareable walkthroughs** — export a cache file that lets a classmate see the exact explanations you saw (makes the "deterministic wording" property of the cache into a feature).

These are one-paragraph placeholders until someone commits to them with a full spec.
