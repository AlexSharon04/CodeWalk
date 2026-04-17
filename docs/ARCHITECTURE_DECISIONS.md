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
