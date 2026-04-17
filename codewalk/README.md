# CodeWalk

VS Code extension that turns a source file into a guided, AI-narrated walkthrough — block by block.

> **Phase status.** This repo currently implements **Phase 1 — Core Loop**. Running `CodeWalk: Start Walkthrough` on an open file segments it via an LLM and renders clickable CodeLens labels plus difficulty-tinted block backgrounds. Clicking a label is intentionally a no-op in Phase 1 — the expand-into-panel behavior lands in Phase 2.

---

## What works today (Phase 1)

- ✅ Segment any open text file into logical blocks via LLM.
- ✅ CodeLens label above each block: `▶ <Block Name> — <one-liner summary>`.
- ✅ Block background tint color-coded by difficulty (trivial / standard / complex / critical).
- ✅ First-run wizard picks a backend and stores the API key (see ADR-004).
- ✅ Ollama auto-detection for private / offline / unsharable-code workflows.
- ✅ 2-retry recovery on malformed JSON, then a typed error surfaced to the user.

## What does not work yet

- ❌ Clicking a CodeLens (Phase 2 — comment panels).
- ❌ Sidebar file picker, multi-file queue, keyboard nav (Phase 3).
- ❌ Per-line annotations, hover detail (Phase 4).

---

## Try it yourself

### 1. Install dependencies and build

```bash
cd codewalk
npm install
npm run build
```

### 2. Choose a backend

CodeWalk ships with two supported paths. Pick whichever fits your situation:

#### Option A — Ollama (local, private, free)

**Best for:** private repositories, unsharable or proprietary code, offline work, zero-cost development.

1. Install Ollama from <https://ollama.com>.
2. Pull a coding-capable model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
3. Start the Ollama server (it runs on `http://localhost:11434` by default). Ollama starts automatically on most platforms once installed.
4. No API key needed. The first-run wizard detects Ollama automatically; if it's running, CodeWalk uses it with zero configuration.

#### Option B — Cloud API key (faster on low-end hardware)

**Best for:** laptops without a dedicated GPU, public code you don't mind sending to a third party, situations where local inference is too slow.

Supported presets (configurable via `codewalk.backend`):

| Preset           | Where to get a key                                         |
| ---------------- | ---------------------------------------------------------- |
| `groq`           | <https://console.groq.com/keys> *(generous free tier)*     |
| `openrouter`     | <https://openrouter.ai/keys> *(pay-as-you-go, many models)* |
| `anthropic-oai`  | <https://console.anthropic.com/settings/keys>              |
| `openai`         | <https://platform.openai.com/api-keys>                     |
| `together`       | <https://api.together.xyz/settings/api-keys>               |
| `custom`         | any OpenAI-compatible endpoint                             |

You do **not** need to edit `settings.json` by hand — the first-run wizard walks you through backend choice and API-key entry the first time you run Start CodeWalk without a configured backend.

### 3. Launch the Extension Development Host

1. Open the `codewalk/` folder in VS Code.
2. Press `F5` (or Run → Start Debugging). A new VS Code window labeled **[Extension Development Host]** opens with CodeWalk loaded.

### 4. Run a walkthrough

In the Extension Development Host window:

1. Open any reasonably-sized source file (the repo ships a fixture at `codewalk/test/fixtures/sample.ts` you can use).
2. Open the command palette (`Ctrl/Cmd+Shift+P`) → **Start CodeWalk**.
3. If this is your first run, the backend wizard fires. Pick a preset; paste an API key if prompted.
4. Watch for `CodeWalk: Analyzing…` in the status bar (lower right).
5. When segmentation finishes you should see:
   - A `▶ Block Name — one-liner` label above each logical block.
   - Background tints on each block (gray = trivial, blue = standard, orange = complex, red = critical).

### 5. What to verify

- [ ] Segments cover every non-blank line of the file (no visible gaps besides blank-line gutters).
- [ ] Difficulty colors match intuition — imports should be trivial (gray), crypto / concurrency should be critical (red).
- [ ] CodeLens labels are 2–6 words, title case; one-liners are ≤80 chars.
- [ ] Clicking a CodeLens does nothing (expected — Phase 2 hook).
- [ ] Running Start CodeWalk a second time on the same file re-segments cleanly (no stale labels, no duplicate decorations).
- [ ] Disabling `codewalk.showBlockHighlights` in settings clears the background tints without removing CodeLens labels.

### 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "CodeWalk can't reach Ollama at …" | Start the Ollama service, or re-run Start CodeWalk and pick a cloud backend. |
| "API key was rejected" | The wizard's key was wrong or expired. Open settings (`Ctrl+,` → search `codewalk`) and update `codewalk.apiKey`. |
| Segmentation hangs forever | Check the **CodeWalk** Output channel for a stack trace. Ollama on integrated GPUs can take 60+ seconds on large files — try a smaller file or switch to a cloud backend. |
| "Couldn't parse the model's response" | The model returned non-JSON twice in a row. Switch to a more capable model (e.g. Groq's `llama-3.3-70b-versatile` or Claude Sonnet). |
| CodeLens labels don't appear | Check the Output channel for a `[success] N segments` line. If missing, segmentation failed — the error toast should also have fired. |

---

## Editing the agent prompt

The segmentation agent's system prompt lives at **`codewalk/prompts/segmentation.md`** — plain markdown, easy to edit. The loader (`src/prompts/loader.ts`) reads it at runtime and caches it. Template variables use `{{placeholder}}` syntax (currently `{{language}}`, `{{filename}}`, `{{code}}`).

Iteration flow:
1. Edit `prompts/segmentation.md`.
2. Reload the Extension Development Host window (`Ctrl+R` inside the host window) — no rebuild needed.
3. Re-run **Start CodeWalk**.

This design is captured in **ADR-002** (see `docs/ARCHITECTURE_DECISIONS.md`). Rationale: prompt iteration is the central craft of an AI-agents course project, and `.md` diffs read cleaner than `.ts` string edits.

Future phases will add more prompts (`explanation.md`, `lineByLine.md`) in the same directory.

---

## Settings reference

| Setting | Default | Purpose |
| --- | --- | --- |
| `codewalk.backend` | `ollama-local` | Preset name. Drives `baseUrl` and model defaults. |
| `codewalk.apiKey` | `""` | API key for cloud backends. Stored at user-global scope (never committed to workspace settings). |
| `codewalk.model` | `""` | Override the preset's default model. |
| `codewalk.baseUrl` | `""` | Override the preset's default URL. Required for `custom`. |
| `codewalk.showBlockHighlights` | `true` | Toggle background tints. CodeLens labels always render. |

---

## Project layout

```
codewalk/
├── prompts/                      # Agent prompts (edit these to change behavior)
│   └── segmentation.md
├── src/
│   ├── commands/
│   │   ├── startWalkthrough.ts   # Main command entry point
│   │   └── firstRunWizard.ts     # Backend picker (ADR-004)
│   ├── engine/
│   │   ├── segmenter.ts          # LLM call + JSON validation + retry
│   │   └── segmentStore.ts       # Per-URI segment cache with change events
│   ├── llm/
│   │   ├── adapter.ts            # Typed errors + LLMAdapter interface
│   │   ├── openAiCompatibleAdapter.ts  # Single adapter for all providers (ADR-001)
│   │   ├── ollamaDetection.ts    # Reachability probe
│   │   └── presets.ts            # Backend preset resolution
│   ├── providers/codeLensProvider.ts   # Renders ▶ labels
│   ├── editor/highlights.ts            # Renders background tints
│   ├── prompts/loader.ts               # Reads prompts/*.md with {{var}} substitution
│   ├── utils/config.ts                 # Reads codewalk.* settings
│   └── extension.ts                    # activate() / deactivate()
└── test/
    ├── fixtures/sample.ts              # File for manual testing
    └── integration/ollamaEndToEnd.test.ts  # Gated on CODEWALK_OLLAMA_TEST=1
```

---

## Development

```bash
cd codewalk
npm install
npm run build       # esbuild one-shot
npm run watch       # esbuild watch mode
npm test            # unit + integration (integration auto-skips without env flag)
npm run package     # produce codewalk-0.1.0.vsix
```

The Ollama integration test is gated behind `CODEWALK_OLLAMA_TEST=1` so CI runs don't require a running Ollama instance.

---

## Related docs

- `../CodeWalk-design-doc.md` — master spec (authoritative).
- `../docs/PROJECT_STATE.md` — current phase, recent decisions, what's next.
- `../docs/IMPLEMENTATION_PLAN.md` — 4-phase roadmap.
- `../docs/ARCHITECTURE_DECISIONS.md` — ADRs (ADR-001 through ADR-004).
- `../docs/superpowers/specs/` and `../docs/superpowers/plans/` — per-phase artifacts.
