# Phase 1 — Core Loop

**Date.** 2026-04-17
**Status.** Draft — awaiting user approval
**Scope.** One phase of the MVP. See `docs/IMPLEMENTATION_PLAN.md` for where Phase 1 sits in the full arc.
**Related.** `CodeWalk-design-doc.md` (master spec), `docs/ARCHITECTURE_DECISIONS.md` (ADRs 001–003 supersede parts of the master spec).

---

## 1. Goal

A VS Code extension that, when the user runs `CodeWalk: Start Walkthrough` on an open file, calls an LLM to segment the file into logical blocks, renders a clickable CodeLens label above each block, and tints each block's background by difficulty.

This is the first demo-able slice. Clicking a CodeLens does nothing yet — expansion arrives in Phase 2.

---

## 2. Scope

### 2.1 In scope

1. **Extension scaffold.** `codewalk/` project created via `yo code` (TypeScript, esbuild), with a working activate/deactivate lifecycle.
2. **LLM adapter.** One `OpenAICompatibleAdapter` class implementing a small interface. Accepts `(baseUrl, apiKey, model)`. Speaks `POST /chat/completions`. Ollama gets a thin auto-detect helper.
3. **Preset system.** Config surface with a `backend` enum that auto-fills `baseUrl` for the selected provider; `custom` lets the user fill all fields manually.
4. **First-run UX.** On first invocation: if Ollama is reachable, use it silently; otherwise show one info notification with a "Configure" button that opens settings.
5. **Prompt loader.** Reads prompt templates from `prompts/*.md` at runtime with `{{placeholder}}` substitution. Caches in memory.
6. **Segmenter.** Orchestrates: load prompt → call adapter → parse JSON → validate against the `Segment` schema. Retries twice on malformed JSON with a stricter prompt on retry 2.
7. **In-memory segment store.** Single module that holds `Segment[]` keyed by document URI. Event emitter so providers can subscribe to changes.
8. **CodeLens provider.** Reads from the store, renders `▶ {label} — {oneLiner}` above each segment's first line.
9. **Block highlighter.** Applies background-color decorations to each segment's line range, color-coded by difficulty (4 tiers, 4 decoration types total).
10. **Start walkthrough command.** Wires everything: read active file → call segmenter → update store → refresh CodeLens → apply decorations. Idempotent — re-running clears prior state first.
11. **Error handling.** Typed errors from the adapter. Segmenter retries per policy. Command catches all errors, shows `showErrorMessage`, logs details to a dedicated Output channel.
12. **Dispose lifecycle.** Deactivating the extension or closing a document disposes its decorations and clears its store entry.

### 2.2 Out of scope (deferred to later phases)

- Expandable explanation panels via `CommentController` (Phase 2).
- Line-by-line annotations and `HoverProvider` (Phase 4).
- TreeView sidebar file picker (Phase 3).
- Multi-file queue, next/prev navigation, keyboard shortcuts (Phase 3).
- Concept detection, danger assessment, "Points to Consider" content generation (Phase 2 — concept detection stretches into Phase 4).
- Streaming segmentation (Phase 1 uses single-shot; streaming is a Phase 2 polish).
- Response caching across runs (stretch goal).
- Multiple file-type special cases; Phase 1 treats every file generically.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                   │
│                                                              │
│  ┌──────────────────┐      ┌──────────────────────────────┐ │
│  │ Start Walkthrough│─────▶│       Walkthrough Engine     │ │
│  │     Command      │      │                              │ │
│  └──────────────────┘      │  ┌────────────────────────┐  │ │
│           │                │  │       Segmenter         │  │ │
│           │                │  └────────┬───────────────┘  │ │
│           │                │           │                  │ │
│           │                │  ┌────────▼───────────────┐  │ │
│           │                │  │    Prompt Loader        │  │ │
│           │                │  └────────────────────────┘  │ │
│           │                │           │                  │ │
│           │                │  ┌────────▼───────────────┐  │ │
│           │                │  │    LLM Adapter          │  │ │
│           │                │  │ (OpenAI-compatible HTTP)│  │ │
│           │                │  └────────────────────────┘  │ │
│           │                └──────────────┬───────────────┘ │
│           │                               │                 │
│           ▼                               ▼                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          In-Memory Segment Store (per URI)            │   │
│  └────────┬─────────────────────────────────┬───────────┘   │
│           │                                 │               │
│  ┌────────▼────────┐             ┌──────────▼────────────┐  │
│  │ CodeLensProvider│             │   Block Highlighter    │  │
│  │ (▶ labels)      │             │ (background decorations)│ │
│  └─────────────────┘             └────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Data flow when `Start Walkthrough` runs

1. Command handler reads the active `TextDocument` and its URI.
2. Command handler asks the store: do we already have segments for this URI? If yes, dispose the entry (idempotent re-run) before continuing.
3. Command handler calls `segmenter.segment(document)`.
4. Segmenter loads `prompts/segmentation.md`, substitutes the code and language into `{{placeholders}}`, calls adapter.
5. Adapter POSTs to `${baseUrl}/chat/completions` with the model and prompt; parses JSON.
6. Segmenter validates each returned segment against the schema, rejects any that fail, and returns `Segment[]`.
7. Command handler writes `Segment[]` to the store under the document URI.
8. The store fires a change event; CodeLens provider and block highlighter each re-render.
9. User sees labels + tinted backgrounds.

---

## 4. Components

Each component owns one file and has a narrow public interface. Units are sized for context; no file should exceed ~200 lines by the end of Phase 1.

### 4.1 LLM Adapter — `src/llm/adapter.ts` + `src/llm/openAiCompatibleAdapter.ts`

**Purpose.** Speak OpenAI-compatible HTTP to any provider.

**Interface (`adapter.ts`).**
```typescript
export interface LLMAdapter {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export interface ChatMessage { role: "system" | "user"; content: string; }
export interface CompleteOptions { responseFormat?: "json_object" | "text"; }

export class NetworkError extends Error {}
export class AuthError extends Error {}
export class RateLimitError extends Error {}
export class MalformedResponseError extends Error {}
```

**Implementation (`openAiCompatibleAdapter.ts`).** Class `OpenAICompatibleAdapter` taking `{ baseUrl, apiKey, model }`. Uses `fetch` to POST `/chat/completions`. Maps HTTP statuses to typed errors: `401/403 → AuthError`, `429 → RateLimitError`, network failures → `NetworkError`. Returns the raw `content` string from `choices[0].message.content`.

**Dependencies.** None beyond Node's `fetch` (VS Code ships Node 20+).

### 4.2 Ollama detection — `src/llm/ollamaDetection.ts`

**Purpose.** One exported function: `isOllamaReachable(endpoint: string): Promise<boolean>`. Sends `GET ${endpoint}/api/tags` with a 1 s timeout. Returns true on any 2xx; false otherwise. Used by first-run logic and preset resolution.

### 4.3 Preset resolver — `src/llm/presets.ts`

**Purpose.** Given the `codewalk.backend` setting, return a `{ baseUrl, defaultModel }` tuple. Presets:

| Backend key | baseUrl | Default model suggestion |
|---|---|---|
| `ollama-local` | `http://localhost:11434/v1` | `qwen2.5-coder:7b` |
| `openrouter` | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct` |
| `groq` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` |
| `anthropic-oai` | `https://api.anthropic.com/v1` | `claude-sonnet-4-6` |
| `together` | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| `custom` | from `codewalk.baseUrl` | from `codewalk.model` |

**Model-ID note.** These defaults reflect model names current as of April 2026. Providers deprecate and rename models frequently; update this table when presets break. Users can always override via `codewalk.model`.

If the user has set `codewalk.baseUrl` or `codewalk.model` explicitly, those override the preset defaults.

### 4.4 Prompt loader — `src/prompts/loader.ts`

**Purpose.** Read a markdown prompt from `prompts/{name}.md`, substitute `{{placeholders}}`.

**Interface.**
```typescript
export function loadPrompt(name: string, vars: Record<string, string>): string;
```

**Behavior.** Reads the file once per session (cached). Substitutes every `{{key}}` with `vars[key]`. Throws if any `{{...}}` remains unsubstituted after pass.

**Prompt files for Phase 1.**
- `prompts/segmentation.md` — see §5.

### 4.5 Segmenter — `src/engine/segmenter.ts`

**Purpose.** Turn a `TextDocument` into `Segment[]`.

**Interface.**
```typescript
export async function segment(doc: vscode.TextDocument, adapter: LLMAdapter): Promise<Segment[]>;
```

**Behavior.**
1. Load `prompts/segmentation.md`, substitute `{{language}}`, `{{filename}}`, `{{code}}` (code includes line numbers).
2. Call `adapter.complete(messages, { responseFormat: "json_object" })`.
3. Attempt to parse as JSON.
4. If parse fails OR any segment fails schema validation:
   - Retry once with a stricter system message appended: *"CRITICAL: respond with ONLY the raw JSON object matching this schema. No markdown fences, no commentary."*
   - If still failing, throw `MalformedResponseError` with the raw response attached.
5. Validate: `startLine >= 1`, `endLine >= startLine`, `endLine <= document.lineCount`, `difficulty` is one of the four enum values, `label` and `oneLiner` are non-empty strings.
6. Generate `id` as `"seg-${index}"` (segment order within file is stable).
7. Populate the `code` field for each segment by calling `document.getText(new Range(startLine - 1, 0, endLine, 0))`. The LLM never sees or sends back the raw code; we extract it locally from the line range it returned.
8. Return validated `Segment[]`.

### 4.6 Segment store — `src/engine/segmentStore.ts`

**Purpose.** In-memory per-document state with change notifications.

**Interface.**
```typescript
export interface SegmentStore {
  get(uri: vscode.Uri): Segment[] | undefined;
  set(uri: vscode.Uri, segments: Segment[]): void;
  clear(uri: vscode.Uri): void;
  onDidChange: vscode.Event<vscode.Uri>;
}
```

**Rationale.** Decouples the command (writer) from the providers (readers). Any future phase that adds writers (e.g., a "reanalyze block" command) plugs in through the same interface.

### 4.7 CodeLens provider — `src/providers/codeLensProvider.ts`

**Purpose.** Render `▶ {label} — {oneLiner}` above each segment's start line.

**Behavior.** Implements `vscode.CodeLensProvider`. On `provideCodeLenses(document)`: look up `store.get(document.uri)`. For each segment, create a `vscode.CodeLens` at `new vscode.Range(segment.startLine - 1, 0, segment.startLine - 1, 0)` with command `codewalk.expandBlock` (unimplemented in Phase 1 — clicking is a no-op but the slot is reserved for Phase 2). Listen to `store.onDidChange` and fire `_onDidChangeCodeLenses` to refresh.

### 4.8 Block highlighter — `src/editor/highlights.ts`

**Purpose.** Apply background-color decorations to segment line ranges.

**Behavior.**
- Create **four** `TextEditorDecorationType` instances at module init (one per difficulty tier): gray, blue, orange, red — all with `isWholeLine: true` and low alpha (~0.08). **Do not create a decoration type per segment** — that leaks memory (see design doc §12.5).
- On `store.onDidChange(uri)`: find the editor(s) showing that URI. For each segment, push its range into the array for its difficulty tier. Then `editor.setDecorations(tierType, tierRanges)` once per tier.
- On document close or store clear: `editor.setDecorations(tierType, [])` to clear.
- Respect `codewalk.showBlockHighlights` — if false, skip setDecorations calls.

### 4.9 Start walkthrough command — `src/commands/startWalkthrough.ts`

**Purpose.** The only user-facing entry point for Phase 1.

**Behavior.**
1. Resolve the active text editor. If none, show info message "Open a file first" and return.
2. Resolve the configured backend via the preset resolver + settings.
3. Backend reachability check, branched by backend:
   - If `backend == "ollama-local"`: call `isOllamaReachable(baseUrl)`. If false, show the first-run notification: "CodeWalk needs an LLM backend. Choose one to continue." with an "Open Settings" button. Return without error.
   - Otherwise: verify `apiKey` is non-empty. If empty, show "CodeWalk needs an API key for the selected backend." with an "Open Settings" button. Return without error.
4. Clear any existing store entry for this URI (idempotent).
5. Show a status-bar progress indicator: "CodeWalk: Analyzing…" (dismissed when done or on error).
6. Construct an `OpenAICompatibleAdapter` from the resolved config.
7. Call `segment(document, adapter)`.
8. Write result to the store.
9. On any error: log raw details to the `CodeWalk` Output channel, show a user-friendly `showErrorMessage` (see §6).

### 4.10 Extension entry point — `src/extension.ts`

**Purpose.** `activate()` and `deactivate()`.

**Behavior.**
- `activate`: create the Output channel, create the segment store, register the CodeLens provider for `{ scheme: "file" }`, register the `codewalk.startWalkthrough` command, register the (no-op) `codewalk.expandBlock` command, wire up the highlighter to `store.onDidChange`, subscribe to `workspace.onDidCloseTextDocument` to clear store entries. Register everything in `context.subscriptions` for disposal.
- `deactivate`: VS Code disposes subscriptions; the four decoration types dispose themselves via their subscription. Explicitly clear the store.

---

## 5. Prompts

### 5.1 `prompts/segmentation.md` (contract, not final text)

Template variables: `{{language}}`, `{{filename}}`, `{{code}}`.

Must produce JSON conforming to:
```jsonc
{
  "segments": [
    {
      "label": "string (2–6 words, title case)",
      "oneLiner": "string (≤ 80 chars, single sentence)",
      "startLine": "integer (1-indexed, inclusive)",
      "endLine": "integer (1-indexed, inclusive)",
      "difficulty": "trivial | standard | complex | critical"
    }
  ]
}
```

Prompt guidance encoded in the file:
- Segment by **semantic purpose**, not syntax alone. A segment is "what is this block trying to accomplish?"
- Typical size 3–30 lines; smaller for imports/config, larger for cohesive functions.
- Difficulty tiers: `trivial` for imports/constants/boilerplate; `standard` for routine logic; `complex` for non-obvious control flow or multi-step algorithms; `critical` for security, concurrency, or side-effect-heavy code.
- Every non-blank line in the file must belong to exactly one segment. Segments do not overlap; gaps (blank-line-only regions) are allowed.
- Return only the JSON object. No prose, no markdown fences.

### 5.2 Retry prompt addendum

On retry after `MalformedResponseError`, prepend to the system message:
> CRITICAL: your previous response was not valid JSON. Respond with ONLY the raw JSON object — no markdown fences, no commentary, no explanation. Begin your response with `{` and end with `}`.

---

## 6. Error handling

### 6.1 Error taxonomy

| Thrown by | Type | User message | Output log |
|---|---|---|---|
| Adapter | `NetworkError` | "CodeWalk couldn't reach the LLM. Check your connection and backend URL." | Full error stack + config (redacting apiKey). |
| Adapter | `AuthError` | "CodeWalk's API key was rejected. Open settings to update it." + "Open Settings" button. | HTTP status + response body. |
| Adapter | `RateLimitError` | "CodeWalk hit a rate limit. Try again in a moment." | HTTP headers, especially `retry-after`. |
| Segmenter | `MalformedResponseError` (after retry) | "CodeWalk couldn't parse the model's response. Try a more capable model in settings." + "Open Settings" button. | Raw response content from both attempts. |
| Anywhere else | generic `Error` | "CodeWalk encountered an unexpected error. See the Output panel." | Stack trace. |

### 6.2 Discipline

- **Never silently fail.** Every error path ends with either a `showErrorMessage`, a `showWarningMessage`, or an `showInformationMessage`.
- **Never half-apply state.** If segmentation fails, do not write partial segments to the store. Either full success or no-op.
- **Redact secrets in logs.** The adapter's logger replaces `apiKey` with `***` when writing to the Output channel.

---

## 7. Configuration surface

`package.json` `contributes.configuration`:

```jsonc
{
  "codewalk.backend": {
    "type": "string",
    "enum": ["ollama-local", "openrouter", "groq", "openai", "anthropic-oai", "together", "custom"],
    "default": "ollama-local",
    "description": "LLM backend preset. Determines baseUrl automatically unless overridden."
  },
  "codewalk.apiKey": {
    "type": "string",
    "default": "",
    "description": "API key for the selected backend. Leave blank for ollama-local."
  },
  "codewalk.model": {
    "type": "string",
    "default": "",
    "description": "Model identifier. Leave blank to use the preset's default."
  },
  "codewalk.baseUrl": {
    "type": "string",
    "default": "",
    "description": "Override the preset's baseUrl. Required when backend is 'custom'."
  },
  "codewalk.showBlockHighlights": {
    "type": "boolean",
    "default": true,
    "description": "Show background color tints for code blocks during a walkthrough."
  }
}
```

Commands registered in `package.json`:
- `codewalk.startWalkthrough` — "Start CodeWalk"
- `codewalk.expandBlock` — registered but a no-op in Phase 1; body arrives in Phase 2.

---

## 8. Data schema (Phase 1 subset)

Only `Segment` is required in Phase 1. `Explanation`, `Concept`, and `LineAnnotation` from the design doc §4 are deferred.

```typescript
export interface Segment {
  id: string;
  label: string;
  oneLiner: string;
  startLine: number;   // 1-indexed, inclusive
  endLine: number;     // 1-indexed, inclusive
  code: string;        // populated post-validation by reading doc.getText(range)
  difficulty: "trivial" | "standard" | "complex" | "critical";
}
```

Types live in `src/types/index.ts`.

---

## 9. Testing

### 9.1 Unit tests (Mocha via `@vscode/test-cli`)

- **Adapter parsing.** Given a canned OpenAI-compatible response body, `complete()` returns the expected `content` string. Given malformed JSON, throws.
- **Adapter error mapping.** `401 → AuthError`, `429 → RateLimitError`, network fail → `NetworkError`.
- **Segmenter retry logic.** Given a mock adapter that returns bad JSON once then good JSON, `segment()` returns segments. Given a mock that always returns bad JSON, throws `MalformedResponseError` after two attempts.
- **Segment validation.** Reject segments where `endLine < startLine` or `startLine < 1`. Reject unknown `difficulty` values.
- **Prompt loader.** Substitutes `{{key}}` correctly. Throws if a placeholder remains unsubstituted.
- **Store.** Writes emit change events; reads after clear return `undefined`.
- **Preset resolver.** Each preset returns the expected baseUrl. `custom` with no baseUrl throws.

### 9.2 Integration test (gated by `INTEGRATION_TESTS=1` env var)

- One end-to-end call against a live Ollama instance using a fixture file. Asserts: non-empty segments, valid schema, line ranges cover the file.

### 9.3 Manual test checklist (end of Phase 1)

Documented in `docs/PROJECT_STATE.md` when the phase closes. At minimum:
1. Open a 50-line TypeScript file, run `Start CodeWalk`, verify labels and tints appear in ≤30 s.
2. Re-run on the same file — no duplicate decorations, no stale CodeLenses.
3. Close and reopen the file — no ghost decorations.
4. Run on an empty file — friendly info message, no crash.
5. Disable Wi-Fi and configure Groq backend — expect `NetworkError` with the correct user message.
6. Set an invalid API key — expect `AuthError` with the "Open Settings" button.
7. Turn off Ollama and run with `ollama-local` default — expect the first-run notification, not an error.
8. Dogfood the default (Ollama-local) on a machine with a GPU at least once before phase close.

---

## 10. File structure (Phase 1)

```
CodeWalk/
├── codewalk/                             ← extension source root (new, Phase 1 creates this)
│   ├── package.json
│   ├── tsconfig.json
│   ├── esbuild.config.js
│   ├── .vscodeignore
│   ├── src/
│   │   ├── extension.ts                  ← 4.10
│   │   ├── commands/
│   │   │   └── startWalkthrough.ts       ← 4.9
│   │   ├── providers/
│   │   │   └── codeLensProvider.ts       ← 4.7
│   │   ├── editor/
│   │   │   └── highlights.ts             ← 4.8
│   │   ├── engine/
│   │   │   ├── segmenter.ts              ← 4.5
│   │   │   └── segmentStore.ts           ← 4.6
│   │   ├── llm/
│   │   │   ├── adapter.ts                ← 4.1 interface
│   │   │   ├── openAiCompatibleAdapter.ts ← 4.1 impl
│   │   │   ├── ollamaDetection.ts        ← 4.2
│   │   │   └── presets.ts                ← 4.3
│   │   ├── prompts/
│   │   │   └── loader.ts                 ← 4.4
│   │   ├── types/
│   │   │   └── index.ts                  ← §8
│   │   └── utils/
│   │       └── config.ts                 ← settings reader
│   ├── prompts/
│   │   └── segmentation.md               ← §5.1
│   ├── test/
│   │   ├── unit/
│   │   │   ├── adapter.test.ts
│   │   │   ├── segmenter.test.ts
│   │   │   ├── promptLoader.test.ts
│   │   │   ├── store.test.ts
│   │   │   └── presets.test.ts
│   │   ├── integration/
│   │   │   └── ollamaEndToEnd.test.ts    ← gated by INTEGRATION_TESTS=1
│   │   └── fixtures/
│   │       └── sampleTypescript.ts
│   └── media/
│       └── icon.svg                      ← placeholder; icon polish is Phase 4
└── ... (docs/ and design doc stay at repo root)
```

---

## 11. Deviations from `CodeWalk-design-doc.md`

Recorded as ADRs in `docs/ARCHITECTURE_DECISIONS.md`:

- **ADR-001.** Single `OpenAICompatibleAdapter` replaces the four-adapter design from §3.5.
- **ADR-002.** Prompts externalized to `prompts/*.md` instead of `src/utils/prompts.ts` per §11.
- **ADR-003.** Ollama-local is the shipped default; first-run UX for the "no backend configured" case is specified.

All other design-doc decisions (data schema shape, UI layering strategy for later phases, activity bar placement, etc.) stand.

---

## 12. Demo acceptance criteria

Phase 1 is done when **all** of these pass on a clean machine:

1. Extension packages as a `.vsix` via `vsce package` with no errors.
2. Installing the `.vsix` into VS Code exposes the `Start CodeWalk` command in the palette.
3. Running the command on an open, non-empty file produces CodeLens labels and tinted backgrounds within 30 s (network-dependent; Ollama on GPU faster).
4. CodeLens labels match the format `▶ {Label} — {OneLiner}`, one per segment.
5. Block backgrounds are visibly tinted and differ by difficulty tier.
6. Re-running the command on the same file refreshes cleanly — no duplicates, no memory leaks over 10 consecutive runs.
7. Each of the seven manual test checklist scenarios (§9.3) behaves as specified.
8. All unit tests pass. Integration test passes when `INTEGRATION_TESTS=1` and Ollama is running locally.

---

## 13. Open questions

None. This spec is complete and ready to convert into an implementation plan.
