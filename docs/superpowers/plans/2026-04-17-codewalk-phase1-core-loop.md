# CodeWalk Phase 1 — Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that runs a `Start CodeWalk` command on an open file, sends it to an OpenAI-compatible LLM, and renders clickable CodeLens labels plus difficulty-tinted block backgrounds for each logical code segment.

**Architecture:** Single TypeScript VS Code extension. One `OpenAICompatibleAdapter` speaks HTTP to any provider (Ollama, Groq, OpenRouter, OpenAI, Anthropic-oai, Together, custom). Segmenter calls the adapter with a markdown-loaded prompt, parses/validates JSON, retries once on malformed response. Results land in an in-memory `SegmentStore` keyed by document URI; a CodeLens provider and a block highlighter subscribe to change events and re-render.

**Tech Stack:** TypeScript 5, VS Code Extension API (`@types/vscode` ≥ 1.85), esbuild for bundling, Mocha via `@vscode/test-cli` for tests, `fetch` from Node 20 built-in.

**Spec reference:** `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md`
**Architectural decisions:** `docs/ARCHITECTURE_DECISIONS.md` (ADR-001, ADR-002, ADR-003)

---

## Task 1: Scaffold the extension project

**Files:**
- Create: `codewalk/package.json`
- Create: `codewalk/tsconfig.json`
- Create: `codewalk/esbuild.config.mjs`
- Create: `codewalk/.vscodeignore`
- Create: `codewalk/.gitignore`
- Create: `codewalk/src/extension.ts` (placeholder)

- [ ] **Step 1: Create `codewalk/package.json`**

```json
{
  "name": "codewalk",
  "displayName": "CodeWalk",
  "description": "AI-guided walkthroughs of unfamiliar codebases, block by block.",
  "version": "0.1.0",
  "publisher": "codewalk-dev",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other", "Education"],
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "codewalk.startWalkthrough", "title": "Start CodeWalk", "icon": "$(book)" },
      { "command": "codewalk.expandBlock", "title": "Expand Block" }
    ],
    "configuration": {
      "title": "CodeWalk",
      "properties": {
        "codewalk.backend": {
          "type": "string",
          "enum": ["ollama-local", "openrouter", "groq", "openai", "anthropic-oai", "together", "custom"],
          "default": "ollama-local",
          "description": "LLM backend preset. Sets baseUrl automatically unless overridden."
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
    }
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "compile-tests": "tsc -p ./ --outDir out",
    "pretest": "npm run compile-tests && npm run build",
    "test": "vscode-test",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^20.10.0",
    "@types/vscode": "^1.85.0",
    "@vscode/test-cli": "^0.0.10",
    "@vscode/test-electron": "^2.3.8",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.20.0",
    "mocha": "^10.2.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create `codewalk/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": ".",
    "sourceMap": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist", "out"]
}
```

- [ ] **Step 3: Create `codewalk/esbuild.config.mjs`**

```javascript
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 4: Create `codewalk/.vscodeignore`**

```
.vscode/**
.vscode-test/**
out/**
src/**
test/**
node_modules/**
esbuild.config.mjs
tsconfig.json
**/*.map
**/*.ts
!dist/**
!prompts/**
!package.json
!README.md
```

- [ ] **Step 5: Create `codewalk/.gitignore`**

```
node_modules/
out/
dist/
*.vsix
.vscode-test/
```

- [ ] **Step 6: Create a placeholder `codewalk/src/extension.ts`**

```typescript
import * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
  // Real wiring lands in Task 14.
  console.log("CodeWalk activated (scaffold).");
}

export function deactivate(): void {
  // No-op in scaffold.
}
```

- [ ] **Step 7: Install dependencies and verify build**

Run from inside `codewalk/`:
```bash
cd codewalk
npm install
npm run build
```
Expected: `dist/extension.js` created, no errors.

- [ ] **Step 8: Commit**

```bash
cd ..
git add codewalk/package.json codewalk/tsconfig.json codewalk/esbuild.config.mjs codewalk/.vscodeignore codewalk/.gitignore codewalk/src/extension.ts
git commit -m "phase1/task1: scaffold codewalk extension project"
```

**Do not commit `codewalk/node_modules` or `codewalk/package-lock.json` yet.** Lockfile commits in Task 17 after all deps stabilize. If npm adds `package-lock.json` and it feels odd to leave it unstaged, add it — it's fine either way.

---

## Task 2: Add shared types

**Files:**
- Create: `codewalk/src/types/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
export type Difficulty = "trivial" | "standard" | "complex" | "critical";

export interface Segment {
  id: string;
  label: string;
  oneLiner: string;
  startLine: number;
  endLine: number;
  code: string;
  difficulty: Difficulty;
}
```

- [ ] **Step 2: Verify compile**

Run from `codewalk/`:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add codewalk/src/types/index.ts
git commit -m "phase1/task2: add Segment and Difficulty types"
```

---

## Task 3: Set up the test runner

**Files:**
- Create: `codewalk/.vscode-test.mjs`
- Create: `codewalk/test/suite/smoke.test.ts`

Rationale: establish Mocha + @vscode/test-cli works before writing real tests. A single passing smoke test is the canary.

- [ ] **Step 1: Create `codewalk/.vscode-test.mjs`**

```javascript
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/suite/**/*.test.js",
  mocha: {
    ui: "tdd",
    timeout: 20000,
    color: true,
  },
});
```

- [ ] **Step 2: Create `codewalk/test/suite/smoke.test.ts`**

```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";

suite("Smoke", () => {
  test("arithmetic works", () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

- [ ] **Step 3: Run the test**

From `codewalk/`:
```bash
npm test
```
Expected: "Smoke > arithmetic works" passes. **If this command fails because `vscode-test` is not on PATH, run `npx vscode-test` instead.** Some Windows shells don't expose `node_modules/.bin` correctly; the `scripts.test` definition in package.json should handle it, but `npx vscode-test` is the fallback.

- [ ] **Step 4: Commit**

```bash
git add codewalk/.vscode-test.mjs codewalk/test/suite/smoke.test.ts
git commit -m "phase1/task3: set up test runner with smoke test"
```

---

## Task 4: Prompt loader (TDD)

**Files:**
- Create: `codewalk/test/fixtures/prompts/hello.md`
- Create: `codewalk/test/suite/promptLoader.test.ts`
- Create: `codewalk/src/prompts/loader.ts`

- [ ] **Step 1: Create the fixture prompt**

Contents of `codewalk/test/fixtures/prompts/hello.md`:
```
Hello {{name}}, your favorite language is {{language}}.
```

- [ ] **Step 2: Write the failing test**

Contents of `codewalk/test/suite/promptLoader.test.ts`:
```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, beforeEach } from "mocha";
import { loadPrompt, clearPromptCache } from "../../src/prompts/loader";

const FIXTURES = path.join(__dirname, "../../../test/fixtures/prompts");

suite("promptLoader", () => {
  beforeEach(() => clearPromptCache());

  test("substitutes placeholders", () => {
    const out = loadPrompt("hello", { name: "Alex", language: "TypeScript" }, FIXTURES);
    assert.strictEqual(out, "Hello Alex, your favorite language is TypeScript.\n");
  });

  test("throws on unsubstituted placeholder", () => {
    assert.throws(
      () => loadPrompt("hello", { name: "Alex" }, FIXTURES),
      /unsubstituted placeholders.*language/i,
    );
  });

  test("throws when file is missing", () => {
    assert.throws(
      () => loadPrompt("does-not-exist", {}, FIXTURES),
      /not found/i,
    );
  });

  test("caches after first load", () => {
    const a = loadPrompt("hello", { name: "A", language: "TS" }, FIXTURES);
    const b = loadPrompt("hello", { name: "B", language: "TS" }, FIXTURES);
    assert.notStrictEqual(a, b); // different substitutions
    assert.ok(a.includes("Hello A"));
    assert.ok(b.includes("Hello B"));
  });
});
```

- [ ] **Step 3: Run the test — verify it fails**

```bash
npm test
```
Expected: compile error (file not found) or test failure "Cannot find module '../../src/prompts/loader'".

- [ ] **Step 4: Write `codewalk/src/prompts/loader.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

const cache = new Map<string, string>();

export function loadPrompt(
  name: string,
  vars: Record<string, string>,
  promptsDir: string,
): string {
  const cacheKey = `${promptsDir}::${name}`;
  let template = cache.get(cacheKey);
  if (template === undefined) {
    const filePath = path.join(promptsDir, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    template = fs.readFileSync(filePath, "utf-8");
    cache.set(cacheKey, template);
  }

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(value);
  }

  const remaining = result.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    throw new Error(`Prompt has unsubstituted placeholders: ${remaining.join(", ")}`);
  }
  return result;
}

export function clearPromptCache(): void {
  cache.clear();
}
```

- [ ] **Step 5: Run the test — verify it passes**

```bash
npm test
```
Expected: all four `promptLoader` tests pass.

- [ ] **Step 6: Commit**

```bash
git add codewalk/src/prompts/loader.ts codewalk/test/suite/promptLoader.test.ts codewalk/test/fixtures/prompts/hello.md
git commit -m "phase1/task4: add prompt loader with placeholder substitution"
```

---

## Task 5: Write the segmentation prompt

**Files:**
- Create: `codewalk/prompts/segmentation.md`

- [ ] **Step 1: Write the prompt content**

Contents of `codewalk/prompts/segmentation.md`:
```
You are a code segmentation agent. You will receive a source file with every line prefixed by its 1-indexed line number. Your job is to divide the file into logical blocks based on **semantic purpose**, not syntax alone.

A segment should answer: "What is this block trying to accomplish?"

## Rules

1. Segments should typically span 3 to 30 lines. Use fewer for imports, constants, or single-line boilerplate; more for cohesive multi-step functions.
2. Every non-blank line must belong to exactly one segment. Blank-line-only gaps between segments are allowed.
3. Segments must not overlap.
4. `startLine` and `endLine` are 1-indexed and inclusive.
5. Assign `difficulty` by the **conceptual complexity** a student would face reading the block:
   - `trivial` — imports, constants, enum declarations, boilerplate.
   - `standard` — routine logic: a getter, a straightforward loop, ordinary branching.
   - `complex` — non-obvious control flow, multi-step algorithms, or code whose correctness depends on subtle invariants.
   - `critical` — security-sensitive code, concurrency primitives, or blocks whose bugs would cause data loss, privilege escalation, or crashes.
6. `label` is 2 to 6 words, title case, describing the block's purpose (e.g., "Database Connection Setup", "JWT Validation", "Recursive Tree Traversal").
7. `oneLiner` is a single sentence, 80 characters or fewer, summarizing what the block does.

## Output

Respond with a single JSON object matching this exact shape:

```json
{
  "segments": [
    {
      "label": "string",
      "oneLiner": "string",
      "startLine": 1,
      "endLine": 5,
      "difficulty": "trivial"
    }
  ]
}
```

Return ONLY the JSON object. No markdown fences, no commentary, no explanation. Begin with `{` and end with `}`.

## Input

Language: {{language}}
Filename: {{filename}}

Source:
{{code}}
```

- [ ] **Step 2: Verify the file is well-formed**

From `codewalk/`:
```bash
node -e "const fs = require('fs'); const c = fs.readFileSync('prompts/segmentation.md','utf-8'); console.log('placeholders:', c.match(/\\{\\{[^}]+\\}\\}/g));"
```
Expected output: `placeholders: [ '{{language}}', '{{filename}}', '{{code}}' ]`.

- [ ] **Step 3: Commit**

```bash
git add codewalk/prompts/segmentation.md
git commit -m "phase1/task5: author segmentation prompt template"
```

---

## Task 6: Config reader and preset resolver (TDD)

**Files:**
- Create: `codewalk/test/suite/presets.test.ts`
- Create: `codewalk/src/llm/presets.ts`
- Create: `codewalk/src/utils/config.ts`

- [ ] **Step 1: Write the failing test**

Contents of `codewalk/test/suite/presets.test.ts`:
```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import { resolveBackend } from "../../src/llm/presets";

suite("presets.resolveBackend", () => {
  test("ollama-local uses localhost and does not require key", () => {
    const r = resolveBackend({ backend: "ollama-local", apiKey: "", model: "", baseUrl: "" });
    assert.strictEqual(r.baseUrl, "http://localhost:11434/v1");
    assert.strictEqual(r.model, "qwen2.5-coder:7b");
    assert.strictEqual(r.requiresApiKey, false);
  });

  test("groq preset returns correct URL and default model", () => {
    const r = resolveBackend({ backend: "groq", apiKey: "k", model: "", baseUrl: "" });
    assert.strictEqual(r.baseUrl, "https://api.groq.com/openai/v1");
    assert.strictEqual(r.model, "llama-3.3-70b-versatile");
    assert.strictEqual(r.requiresApiKey, true);
  });

  test("user baseUrl overrides preset", () => {
    const r = resolveBackend({ backend: "groq", apiKey: "k", model: "", baseUrl: "https://proxy.example/v1" });
    assert.strictEqual(r.baseUrl, "https://proxy.example/v1");
  });

  test("user model overrides preset default", () => {
    const r = resolveBackend({ backend: "openai", apiKey: "k", model: "gpt-4o", baseUrl: "" });
    assert.strictEqual(r.model, "gpt-4o");
  });

  test("custom requires baseUrl", () => {
    assert.throws(
      () => resolveBackend({ backend: "custom", apiKey: "", model: "", baseUrl: "" }),
      /baseUrl/,
    );
  });

  test("custom works when baseUrl is set", () => {
    const r = resolveBackend({ backend: "custom", apiKey: "k", model: "m", baseUrl: "https://x.example/v1" });
    assert.strictEqual(r.baseUrl, "https://x.example/v1");
    assert.strictEqual(r.model, "m");
  });

  test("all non-custom presets are covered", () => {
    const backends = ["ollama-local", "openrouter", "groq", "openai", "anthropic-oai", "together"] as const;
    for (const b of backends) {
      const r = resolveBackend({ backend: b, apiKey: "k", model: "", baseUrl: "" });
      assert.ok(r.baseUrl.length > 0, `${b} must have baseUrl`);
      assert.ok(r.model.length > 0, `${b} must have default model`);
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test
```
Expected: cannot find module `../../src/llm/presets`.

- [ ] **Step 3: Write `codewalk/src/llm/presets.ts`**

```typescript
export type BackendKey =
  | "ollama-local"
  | "openrouter"
  | "groq"
  | "openai"
  | "anthropic-oai"
  | "together"
  | "custom";

export interface PresetConfig {
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}

const PRESETS: Record<Exclude<BackendKey, "custom">, PresetConfig> = {
  "ollama-local":  { baseUrl: "http://localhost:11434/v1",      defaultModel: "qwen2.5-coder:7b",                        requiresApiKey: false },
  "openrouter":    { baseUrl: "https://openrouter.ai/api/v1",   defaultModel: "meta-llama/llama-3.3-70b-instruct",       requiresApiKey: true  },
  "groq":          { baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile",                 requiresApiKey: true  },
  "openai":        { baseUrl: "https://api.openai.com/v1",      defaultModel: "gpt-4o-mini",                             requiresApiKey: true  },
  "anthropic-oai": { baseUrl: "https://api.anthropic.com/v1",   defaultModel: "claude-sonnet-4-6",                       requiresApiKey: true  },
  "together":      { baseUrl: "https://api.together.xyz/v1",    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", requiresApiKey: true  },
};

export interface UserConfig {
  backend: BackendKey;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ResolvedBackend {
  backend: BackendKey;
  baseUrl: string;
  apiKey: string;
  model: string;
  requiresApiKey: boolean;
}

export function resolveBackend(cfg: UserConfig): ResolvedBackend {
  if (cfg.backend === "custom") {
    if (!cfg.baseUrl) {
      throw new Error("Custom backend requires codewalk.baseUrl to be set");
    }
    return {
      backend: "custom",
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model || "",
      requiresApiKey: false,
    };
  }
  const preset = PRESETS[cfg.backend];
  return {
    backend: cfg.backend,
    baseUrl: cfg.baseUrl || preset.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model || preset.defaultModel,
    requiresApiKey: preset.requiresApiKey,
  };
}
```

- [ ] **Step 4: Write `codewalk/src/utils/config.ts`**

```typescript
import * as vscode from "vscode";
import type { BackendKey, UserConfig } from "../llm/presets";

export function readUserConfig(): UserConfig {
  const c = vscode.workspace.getConfiguration("codewalk");
  return {
    backend: c.get<BackendKey>("backend", "ollama-local"),
    apiKey: c.get<string>("apiKey", ""),
    model: c.get<string>("model", ""),
    baseUrl: c.get<string>("baseUrl", ""),
  };
}

export function isBlockHighlightsEnabled(): boolean {
  return vscode.workspace.getConfiguration("codewalk").get<boolean>("showBlockHighlights", true);
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npm test
```
Expected: all `presets.resolveBackend` tests pass.

- [ ] **Step 6: Commit**

```bash
git add codewalk/src/llm/presets.ts codewalk/src/utils/config.ts codewalk/test/suite/presets.test.ts
git commit -m "phase1/task6: preset resolver and config reader"
```

---

## Task 7: LLM adapter interface and error types

**Files:**
- Create: `codewalk/src/llm/adapter.ts`

This task defines types only — no tests here because there's no behavior. Behavior tests arrive in Task 8.

- [ ] **Step 1: Write `codewalk/src/llm/adapter.ts`**

```typescript
export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface CompleteOptions {
  responseFormat?: "json_object" | "text";
}

export interface LLMAdapter {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class MalformedResponseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "MalformedResponseError";
  }
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add codewalk/src/llm/adapter.ts
git commit -m "phase1/task7: LLM adapter interface and typed errors"
```

---

## Task 8: OpenAI-compatible adapter implementation (TDD)

**Files:**
- Create: `codewalk/test/suite/adapter.test.ts`
- Create: `codewalk/src/llm/openAiCompatibleAdapter.ts`

We mock `fetch` via a dependency injection seam so tests don't touch the network.

- [ ] **Step 1: Write the failing test**

Contents of `codewalk/test/suite/adapter.test.ts`:
```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import {
  OpenAICompatibleAdapter,
  type FetchFn,
} from "../../src/llm/openAiCompatibleAdapter";
import {
  AuthError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../../src/llm/adapter";

function mockFetch(response: {
  status?: number;
  ok?: boolean;
  body?: unknown;
  bodyText?: string;
  headers?: Record<string, string>;
  throws?: Error;
}): FetchFn {
  return async () => {
    if (response.throws) throw response.throws;
    const status = response.status ?? 200;
    return {
      status,
      ok: response.ok ?? (status >= 200 && status < 300),
      json: async () => response.body,
      text: async () => response.bodyText ?? JSON.stringify(response.body ?? {}),
      headers: {
        get: (name: string) => response.headers?.[name.toLowerCase()] ?? null,
      },
    } as unknown as Response;
  };
}

const CFG = { baseUrl: "http://x/v1", apiKey: "test-key", model: "m" };

suite("OpenAICompatibleAdapter.complete", () => {
  test("returns content on 200", async () => {
    const fetchFn = mockFetch({
      body: { choices: [{ message: { content: "hello world" } }] },
    });
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    const out = await a.complete([{ role: "user", content: "hi" }]);
    assert.strictEqual(out, "hello world");
  });

  test("sends Authorization header when apiKey is set", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedInit = init;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await a.complete([{ role: "user", content: "hi" }]);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.strictEqual(headers["Authorization"], "Bearer test-key");
    assert.strictEqual(headers["Content-Type"], "application/json");
  });

  test("omits Authorization header when apiKey is empty", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedInit = init;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter({ ...CFG, apiKey: "" }, fetchFn);
    await a.complete([{ role: "user", content: "hi" }]);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.strictEqual(headers["Authorization"], undefined);
  });

  test("includes response_format when requested", async () => {
    let capturedBody: string | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedBody = init?.body as string;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await a.complete([{ role: "user", content: "hi" }], { responseFormat: "json_object" });
    const parsed = JSON.parse(capturedBody!);
    assert.deepStrictEqual(parsed.response_format, { type: "json_object" });
  });

  test("throws AuthError on 401", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 401, bodyText: "bad key" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      AuthError,
    );
  });

  test("throws AuthError on 403", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 403, bodyText: "forbidden" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      AuthError,
    );
  });

  test("throws RateLimitError on 429 with retry-after", async () => {
    const a = new OpenAICompatibleAdapter(
      CFG,
      mockFetch({ status: 429, headers: { "retry-after": "7" }, bodyText: "slow down" }),
    );
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      (e: unknown) => e instanceof RateLimitError && e.retryAfter === 7,
    );
  });

  test("throws NetworkError on fetch exception", async () => {
    const a = new OpenAICompatibleAdapter(
      CFG,
      mockFetch({ throws: new Error("ECONNREFUSED") }),
    );
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      NetworkError,
    );
  });

  test("throws NetworkError on non-2xx non-auth non-rate status", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 500, bodyText: "server down" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      NetworkError,
    );
  });

  test("throws MalformedResponseError when choices missing", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ body: { error: "oops" } }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      MalformedResponseError,
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test
```
Expected: cannot find module `../../src/llm/openAiCompatibleAdapter`.

- [ ] **Step 3: Write `codewalk/src/llm/openAiCompatibleAdapter.ts`**

```typescript
import {
  AuthError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
  type ChatMessage,
  type CompleteOptions,
  type LLMAdapter,
} from "./adapter";

export interface AdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type FetchFn = typeof fetch;

interface ChatResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  constructor(
    private readonly cfg: AdapterConfig,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: 0.2,
    };
    if (options?.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new NetworkError(`Failed to reach ${url}: ${(e as Error).message}`, e);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Authentication failed (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
      throw new RateLimitError(`Rate limit exceeded (HTTP 429)`, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new NetworkError(`HTTP ${response.status}: ${text}`);
    }

    let parsed: ChatResponseBody;
    try {
      parsed = (await response.json()) as ChatResponseBody;
    } catch (e) {
      throw new MalformedResponseError(`Response body was not valid JSON: ${(e as Error).message}`);
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new MalformedResponseError(
        "Response did not contain choices[0].message.content",
        JSON.stringify(parsed),
      );
    }
    return content;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```
Expected: all 10 `OpenAICompatibleAdapter.complete` tests pass plus prior tasks.

- [ ] **Step 5: Commit**

```bash
git add codewalk/src/llm/openAiCompatibleAdapter.ts codewalk/test/suite/adapter.test.ts
git commit -m "phase1/task8: OpenAI-compatible adapter with typed errors"
```

---

## Task 9: Ollama detection (TDD)

**Files:**
- Create: `codewalk/test/suite/ollamaDetection.test.ts`
- Create: `codewalk/src/llm/ollamaDetection.ts`

- [ ] **Step 1: Write the failing test**

Contents of `codewalk/test/suite/ollamaDetection.test.ts`:
```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import { isOllamaReachable, type FetchFn } from "../../src/llm/ollamaDetection";

suite("isOllamaReachable", () => {
  test("strips /v1 suffix and targets /api/tags", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = async (url) => {
      capturedUrl = String(url);
      return { ok: true } as Response;
    };
    await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn);
    assert.strictEqual(capturedUrl, "http://localhost:11434/api/tags");
  });

  test("returns true on 2xx", async () => {
    const fetchFn: FetchFn = async () => ({ ok: true } as Response);
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), true);
  });

  test("returns false on non-2xx", async () => {
    const fetchFn: FetchFn = async () => ({ ok: false } as Response);
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), false);
  });

  test("returns false on fetch rejection", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("ECONNREFUSED"); };
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), false);
  });

  test("handles baseUrl without /v1 suffix", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = async (url) => {
      capturedUrl = String(url);
      return { ok: true } as Response;
    };
    await isOllamaReachable("http://localhost:11434", 1000, fetchFn);
    assert.strictEqual(capturedUrl, "http://localhost:11434/api/tags");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test
```
Expected: cannot find module.

- [ ] **Step 3: Write `codewalk/src/llm/ollamaDetection.ts`**

```typescript
export type FetchFn = typeof fetch;

export async function isOllamaReachable(
  baseUrl: string,
  timeoutMs = 1000,
  fetchImpl: FetchFn = fetch,
): Promise<boolean> {
  const rootUrl = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const tagsUrl = `${rootUrl}/api/tags`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(tagsUrl, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```
Expected: all 5 `isOllamaReachable` tests pass.

- [ ] **Step 5: Commit**

```bash
git add codewalk/src/llm/ollamaDetection.ts codewalk/test/suite/ollamaDetection.test.ts
git commit -m "phase1/task9: Ollama reachability detection"
```

---

## Task 10: Segment store (TDD)

**Files:**
- Create: `codewalk/test/suite/segmentStore.test.ts`
- Create: `codewalk/src/engine/segmentStore.ts`

- [ ] **Step 1: Write the failing test**

Contents of `codewalk/test/suite/segmentStore.test.ts`:
```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { SegmentStore } from "../../src/engine/segmentStore";
import type { Segment } from "../../src/types";

function fakeSegment(startLine = 1): Segment {
  return {
    id: "seg-0",
    label: "Test Block",
    oneLiner: "a test segment",
    startLine,
    endLine: startLine + 5,
    code: "x",
    difficulty: "standard",
  };
}

suite("SegmentStore", () => {
  test("get returns undefined before any set", () => {
    const s = new SegmentStore();
    assert.strictEqual(s.get(vscode.Uri.file("/tmp/a")), undefined);
    s.dispose();
  });

  test("set then get returns the same segments", () => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/a");
    const segs = [fakeSegment()];
    s.set(uri, segs);
    assert.deepStrictEqual(s.get(uri), segs);
    s.dispose();
  });

  test("set fires onDidChange with the uri", (done) => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/b");
    const sub = s.onDidChange((changedUri) => {
      try {
        assert.strictEqual(changedUri.toString(), uri.toString());
        sub.dispose();
        s.dispose();
        done();
      } catch (e) { done(e); }
    });
    s.set(uri, [fakeSegment()]);
  });

  test("clear removes entry and fires onDidChange", (done) => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/c");
    s.set(uri, [fakeSegment()]);
    const sub = s.onDidChange((changedUri) => {
      try {
        assert.strictEqual(changedUri.toString(), uri.toString());
        assert.strictEqual(s.get(uri), undefined);
        sub.dispose();
        s.dispose();
        done();
      } catch (e) { done(e); }
    });
    s.clear(uri);
  });

  test("clear on missing uri does not fire", () => {
    const s = new SegmentStore();
    let fired = false;
    const sub = s.onDidChange(() => { fired = true; });
    s.clear(vscode.Uri.file("/tmp/never"));
    sub.dispose();
    s.dispose();
    assert.strictEqual(fired, false);
  });

  test("different URIs are independent", () => {
    const s = new SegmentStore();
    const a = vscode.Uri.file("/tmp/a");
    const b = vscode.Uri.file("/tmp/b");
    s.set(a, [fakeSegment(1)]);
    s.set(b, [fakeSegment(100)]);
    assert.strictEqual(s.get(a)?.[0].startLine, 1);
    assert.strictEqual(s.get(b)?.[0].startLine, 100);
    s.dispose();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test
```
Expected: cannot find module.

- [ ] **Step 3: Write `codewalk/src/engine/segmentStore.ts`**

```typescript
import * as vscode from "vscode";
import type { Segment } from "../types";

export class SegmentStore implements vscode.Disposable {
  private readonly map = new Map<string, Segment[]>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  get(uri: vscode.Uri): Segment[] | undefined {
    return this.map.get(uri.toString());
  }

  set(uri: vscode.Uri, segments: Segment[]): void {
    this.map.set(uri.toString(), segments);
    this._onDidChange.fire(uri);
  }

  clear(uri: vscode.Uri): void {
    if (this.map.delete(uri.toString())) {
      this._onDidChange.fire(uri);
    }
  }

  dispose(): void {
    this.map.clear();
    this._onDidChange.dispose();
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```
Expected: all 6 `SegmentStore` tests pass.

- [ ] **Step 5: Commit**

```bash
git add codewalk/src/engine/segmentStore.ts codewalk/test/suite/segmentStore.test.ts
git commit -m "phase1/task10: segment store with change events"
```

---

## Task 11: Segmenter with retry logic (TDD)

**Files:**
- Create: `codewalk/test/fixtures/prompts/segmentation.md`
- Create: `codewalk/test/suite/segmenter.test.ts`
- Create: `codewalk/src/engine/segmenter.ts`

- [ ] **Step 1: Create the test-fixture prompt**

Contents of `codewalk/test/fixtures/prompts/segmentation.md`:
```
Language: {{language}}
Filename: {{filename}}

{{code}}
```

A minimal fixture prompt is fine for tests — the real prompt lives at `codewalk/prompts/segmentation.md` (Task 5) and is loaded via `context.asAbsolutePath("prompts")` at runtime.

- [ ] **Step 2: Write the failing test**

Contents of `codewalk/test/suite/segmenter.test.ts`:
```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, beforeEach } from "mocha";
import * as vscode from "vscode";
import { segment } from "../../src/engine/segmenter";
import { clearPromptCache } from "../../src/prompts/loader";
import type { ChatMessage, CompleteOptions, LLMAdapter } from "../../src/llm/adapter";
import { MalformedResponseError } from "../../src/llm/adapter";

const FIXTURES_DIR = path.join(__dirname, "../../../test/fixtures/prompts");

class StubAdapter implements LLMAdapter {
  public calls: Array<{ messages: ChatMessage[]; options?: CompleteOptions }> = [];
  constructor(private readonly responses: Array<string | Error>) {}
  async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    const next = this.responses.shift();
    if (next === undefined) throw new Error("StubAdapter exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

async function openDoc(text: string, language = "typescript"): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content: text, language });
}

suite("segmenter.segment", () => {
  beforeEach(() => clearPromptCache());

  test("returns validated segments on first-try success", async () => {
    const doc = await openDoc("line1\nline2\nline3\nline4\nline5\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "Header", oneLiner: "first block", startLine: 1, endLine: 3, difficulty: "trivial" },
        { label: "Body",   oneLiner: "second block", startLine: 4, endLine: 5, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, "seg-0");
    assert.strictEqual(result[0].label, "Header");
    assert.strictEqual(result[0].difficulty, "trivial");
    assert.strictEqual(result[1].id, "seg-1");
    assert.ok(result[0].code.length > 0);
  });

  test("retries on malformed JSON and succeeds", async () => {
    const doc = await openDoc("a\nb\nc\n");
    const adapter = new StubAdapter([
      "not json at all",
      JSON.stringify({ segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 2, difficulty: "standard" }] }),
    ]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(adapter.calls.length, 2);
    assert.strictEqual(result.length, 1);
    const retrySystemMsg = adapter.calls[1].messages.find(m => m.role === "system")?.content ?? "";
    assert.ok(retrySystemMsg.includes("CRITICAL"), "retry should include stricter instruction");
  });

  test("throws MalformedResponseError after two failed attempts", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter(["garbage", "still garbage"]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects segments with endLine < startLine", async () => {
    const doc = await openDoc("a\nb\nc\nd\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "Bad",  oneLiner: "inverted", startLine: 3, endLine: 1, difficulty: "standard" },
        { label: "Good", oneLiner: "ok",        startLine: 1, endLine: 2, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, "Good");
  });

  test("rejects segments with invalid difficulty", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 2, difficulty: "extreme" }],
    })]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects segments with empty label", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "",  oneLiner: "y", startLine: 1, endLine: 1, difficulty: "standard" },
        { label: "Z", oneLiner: "w", startLine: 2, endLine: 2, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, "Z");
  });

  test("populates code field from document range", async () => {
    const doc = await openDoc("alpha\nbeta\ngamma\ndelta\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 2, endLine: 3, difficulty: "standard" }],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.ok(result[0].code.includes("beta"));
    assert.ok(result[0].code.includes("gamma"));
    assert.ok(!result[0].code.includes("alpha"));
  });

  test("first attempt uses json_object response format", async () => {
    const doc = await openDoc("a\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 1, difficulty: "standard" }],
    })]);
    await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(adapter.calls[0].options?.responseFormat, "json_object");
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
npm test
```
Expected: cannot find module `../../src/engine/segmenter`.

- [ ] **Step 4: Write `codewalk/src/engine/segmenter.ts`**

```typescript
import * as vscode from "vscode";
import type { Segment, Difficulty } from "../types";
import type { ChatMessage, LLMAdapter } from "../llm/adapter";
import { MalformedResponseError } from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

const RETRY_SYSTEM_ADDENDUM =
  "\n\nCRITICAL: your previous response was not valid JSON. Respond with ONLY the raw JSON object — no markdown fences, no commentary, no explanation. Begin your response with { and end with }.";

const VALID_DIFFICULTIES = new Set<Difficulty>(["trivial", "standard", "complex", "critical"]);

interface RawSegment {
  label?: unknown;
  oneLiner?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  difficulty?: unknown;
}

export interface SegmenterDeps {
  adapter: LLMAdapter;
  promptsDir: string;
}

export async function segment(
  document: vscode.TextDocument,
  deps: SegmenterDeps,
): Promise<Segment[]> {
  const numberedCode = numberLines(document.getText());
  const systemPrompt = loadPrompt(
    "segmentation",
    {
      language: document.languageId,
      filename: document.fileName,
      code: numberedCode,
    },
    deps.promptsDir,
  );

  const baseMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  let firstRaw: string | undefined;
  try {
    firstRaw = await deps.adapter.complete(baseMessages, { responseFormat: "json_object" });
    return parseAndValidate(firstRaw, document);
  } catch (firstError) {
    if (!(firstError instanceof ValidationFailure) && !(firstError instanceof MalformedResponseError)) {
      throw firstError;
    }
    const retryMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt + RETRY_SYSTEM_ADDENDUM },
    ];
    let secondRaw: string | undefined;
    try {
      secondRaw = await deps.adapter.complete(retryMessages, { responseFormat: "json_object" });
      return parseAndValidate(secondRaw, document);
    } catch (secondError) {
      throw new MalformedResponseError(
        "LLM did not return valid segment JSON after retry",
        JSON.stringify({ first: firstRaw, second: secondRaw ?? "<no response>" }),
      );
    }
  }
}

class ValidationFailure extends Error {}

function numberLines(text: string): string {
  return text.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n");
}

function parseAndValidate(raw: string, document: vscode.TextDocument): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("Response is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { segments?: unknown }).segments)) {
    throw new ValidationFailure("Response does not contain a 'segments' array");
  }
  const rawSegments = (parsed as { segments: RawSegment[] }).segments;
  const lineCount = document.lineCount;
  const validated: Segment[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const r = rawSegments[i];
    const startLine = Number(r.startLine);
    const endLine = Number(r.endLine);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const oneLiner = typeof r.oneLiner === "string" ? r.oneLiner.trim() : "";
    const difficulty = typeof r.difficulty === "string" ? r.difficulty : "";
    if (!Number.isInteger(startLine) || startLine < 1) continue;
    if (!Number.isInteger(endLine) || endLine < startLine) continue;
    if (endLine > lineCount) continue;
    if (label.length === 0 || oneLiner.length === 0) continue;
    if (!VALID_DIFFICULTIES.has(difficulty as Difficulty)) continue;
    const range = new vscode.Range(
      startLine - 1,
      0,
      Math.min(endLine, lineCount) - 1,
      Number.MAX_SAFE_INTEGER,
    );
    const codeText = document.getText(range);
    validated.push({
      id: `seg-${i}`,
      label,
      oneLiner,
      startLine,
      endLine,
      code: codeText,
      difficulty: difficulty as Difficulty,
    });
  }
  if (validated.length === 0) {
    throw new ValidationFailure("No segments passed validation");
  }
  return validated;
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npm test
```
Expected: all 8 `segmenter.segment` tests pass.

- [ ] **Step 6: Commit**

```bash
git add codewalk/src/engine/segmenter.ts codewalk/test/suite/segmenter.test.ts codewalk/test/fixtures/prompts/segmentation.md
git commit -m "phase1/task11: segmenter with retry and validation"
```

---

## Task 12: CodeLens provider

**Files:**
- Create: `codewalk/src/providers/codeLensProvider.ts`

No unit test — provider exercises the VS Code extension host and is easier to verify via the manual checklist in Task 17. The store + segmenter tests already cover the data flow feeding this component.

- [ ] **Step 1: Write `codewalk/src/providers/codeLensProvider.ts`**

```typescript
import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";

export class CodeWalkLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private readonly storeSubscription: vscode.Disposable;

  constructor(private readonly store: SegmentStore) {
    this.storeSubscription = store.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const segments = this.store.get(document.uri) ?? [];
    return segments.map((seg) => {
      const range = new vscode.Range(seg.startLine - 1, 0, seg.startLine - 1, 0);
      return new vscode.CodeLens(range, {
        title: `▶ ${seg.label} — ${seg.oneLiner}`,
        command: "codewalk.expandBlock",
        arguments: [seg.id],
      });
    });
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    this.storeSubscription.dispose();
  }
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add codewalk/src/providers/codeLensProvider.ts
git commit -m "phase1/task12: CodeLens provider reading from segment store"
```

---

## Task 13: Block highlighter

**Files:**
- Create: `codewalk/src/editor/highlights.ts`

- [ ] **Step 1: Write `codewalk/src/editor/highlights.ts`**

```typescript
import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { Difficulty } from "../types";
import { isBlockHighlightsEnabled } from "../utils/config";

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  trivial:  "rgba(128, 128, 128, 0.06)",
  standard: "rgba(100, 149, 237, 0.08)",
  complex:  "rgba(255, 165, 0, 0.10)",
  critical: "rgba(220, 53, 69, 0.12)",
};

export class BlockHighlighter implements vscode.Disposable {
  private readonly decorationTypes: Record<Difficulty, vscode.TextEditorDecorationType>;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly store: SegmentStore) {
    this.decorationTypes = {
      trivial:  vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.trivial,  isWholeLine: true }),
      standard: vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.standard, isWholeLine: true }),
      complex:  vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.complex,  isWholeLine: true }),
      critical: vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.critical, isWholeLine: true }),
    };
    this.subscriptions = [
      store.onDidChange((uri) => this.refreshUri(uri)),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this.applyToEditor(editor);
      }),
    ];
  }

  private refreshUri(uri: vscode.Uri): void {
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === uri.toString(),
    );
    for (const editor of editors) this.applyToEditor(editor);
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const enabled = isBlockHighlightsEnabled();
    const segments = this.store.get(editor.document.uri) ?? [];
    const grouped: Record<Difficulty, vscode.Range[]> = {
      trivial: [],
      standard: [],
      complex: [],
      critical: [],
    };
    if (enabled) {
      for (const seg of segments) {
        grouped[seg.difficulty].push(
          new vscode.Range(seg.startLine - 1, 0, seg.endLine - 1, Number.MAX_SAFE_INTEGER),
        );
      }
    }
    for (const diff of Object.keys(grouped) as Difficulty[]) {
      editor.setDecorations(this.decorationTypes[diff], grouped[diff]);
    }
  }

  dispose(): void {
    for (const dt of Object.values(this.decorationTypes)) dt.dispose();
    for (const s of this.subscriptions) s.dispose();
  }
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add codewalk/src/editor/highlights.ts
git commit -m "phase1/task13: block highlighter with difficulty-tinted decorations"
```

---

## Task 14: Start walkthrough command with error handling

**Files:**
- Create: `codewalk/src/commands/startWalkthrough.ts`

- [ ] **Step 1: Write `codewalk/src/commands/startWalkthrough.ts`**

```typescript
import * as vscode from "vscode";
import { readUserConfig } from "../utils/config";
import { resolveBackend } from "../llm/presets";
import { OpenAICompatibleAdapter } from "../llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../llm/ollamaDetection";
import { segment } from "../engine/segmenter";
import type { SegmentStore } from "../engine/segmentStore";
import {
  AuthError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../llm/adapter";

export function registerStartWalkthrough(
  context: vscode.ExtensionContext,
  store: SegmentStore,
  output: vscode.OutputChannel,
): vscode.Disposable {
  return vscode.commands.registerCommand("codewalk.startWalkthrough", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Open a file first to start CodeWalk.");
      return;
    }
    const document = editor.document;
    if (document.getText().trim().length === 0) {
      vscode.window.showInformationMessage("This file is empty — nothing to walk through.");
      return;
    }

    const userConfig = readUserConfig();
    let resolved;
    try {
      resolved = resolveBackend(userConfig);
    } catch (e) {
      showSettingsError(`CodeWalk config error: ${(e as Error).message}`);
      return;
    }

    if (resolved.backend === "ollama-local") {
      const ok = await isOllamaReachable(resolved.baseUrl);
      if (!ok) {
        showSettingsInfo("CodeWalk needs an LLM backend. Choose one to continue.");
        return;
      }
    } else if (resolved.requiresApiKey && !resolved.apiKey) {
      showSettingsInfo("CodeWalk needs an API key for the selected backend.");
      return;
    }

    store.clear(document.uri);

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "CodeWalk: Analyzing…",
      },
      async () => {
        try {
          const promptsDir = context.asAbsolutePath("prompts");
          const segments = await segment(document, { adapter, promptsDir });
          store.set(document.uri, segments);
          output.appendLine(`[success] ${segments.length} segments for ${document.fileName}`);
        } catch (e) {
          handleError(e, output);
        }
      },
    );
  });
}

function showSettingsInfo(message: string): void {
  vscode.window
    .showInformationMessage(message, "Open Settings")
    .then((action) => {
      if (action === "Open Settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "codewalk");
      }
    });
}

function showSettingsError(message: string): void {
  vscode.window
    .showErrorMessage(message, "Open Settings")
    .then((action) => {
      if (action === "Open Settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "codewalk");
      }
    });
}

function handleError(e: unknown, output: vscode.OutputChannel): void {
  if (e instanceof NetworkError) {
    output.appendLine(`[NetworkError] ${e.message}`);
    vscode.window.showErrorMessage(
      "CodeWalk couldn't reach the LLM. Check your connection and backend URL.",
    );
  } else if (e instanceof AuthError) {
    output.appendLine(`[AuthError] ${e.message}`);
    showSettingsError("CodeWalk's API key was rejected. Open settings to update it.");
  } else if (e instanceof RateLimitError) {
    output.appendLine(`[RateLimitError] ${e.message}${e.retryAfter ? ` retry-after: ${e.retryAfter}s` : ""}`);
    vscode.window.showErrorMessage("CodeWalk hit a rate limit. Try again in a moment.");
  } else if (e instanceof MalformedResponseError) {
    output.appendLine(`[MalformedResponseError] ${e.message}\nRaw: ${e.rawResponse ?? "<none>"}`);
    showSettingsError(
      "CodeWalk couldn't parse the model's response. Try a more capable model in settings.",
    );
  } else {
    const err = e as Error;
    output.appendLine(`[Unhandled] ${err.stack ?? err.message ?? String(e)}`);
    vscode.window.showErrorMessage(
      "CodeWalk encountered an unexpected error. See the Output panel.",
    );
  }
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add codewalk/src/commands/startWalkthrough.ts
git commit -m "phase1/task14: start walkthrough command with typed error handling"
```

---

## Task 15: Wire extension entry point

**Files:**
- Modify: `codewalk/src/extension.ts` (replaces the Task 1 placeholder)

- [ ] **Step 1: Replace `codewalk/src/extension.ts` with the real implementation**

```typescript
import * as vscode from "vscode";
import { SegmentStore } from "./engine/segmentStore";
import { CodeWalkLensProvider } from "./providers/codeLensProvider";
import { BlockHighlighter } from "./editor/highlights";
import { registerStartWalkthrough } from "./commands/startWalkthrough";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeWalk");
  const store = new SegmentStore();

  const lensProvider = new CodeWalkLensProvider(store);
  const highlighter = new BlockHighlighter(store);

  const lensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: "file" },
    lensProvider,
  );

  const startCommand = registerStartWalkthrough(context, store, output);

  const expandBlockCommand = vscode.commands.registerCommand(
    "codewalk.expandBlock",
    (_segmentId?: string) => {
      // Phase 2 will implement panel expansion; Phase 1 keeps this no-op so the CodeLens command resolves.
    },
  );

  const closeHandler = vscode.workspace.onDidCloseTextDocument((doc) => {
    store.clear(doc.uri);
  });

  context.subscriptions.push(
    output,
    store,
    lensProvider,
    highlighter,
    lensRegistration,
    startCommand,
    expandBlockCommand,
    closeHandler,
  );

  output.appendLine("CodeWalk activated.");
}

export function deactivate(): void {
  // VS Code disposes everything in context.subscriptions automatically.
}
```

- [ ] **Step 2: Build the extension**

From `codewalk/`:
```bash
npm run build
```
Expected: `dist/extension.js` rebuilt, no errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```
Expected: all tests from Tasks 3, 4, 6, 8, 9, 10, 11 pass.

- [ ] **Step 4: Commit**

```bash
git add codewalk/src/extension.ts
git commit -m "phase1/task15: wire extension entry point, register providers and command"
```

---

## Task 16: Gated integration test for Ollama

**Files:**
- Create: `codewalk/test/integration/ollamaEndToEnd.test.ts`
- Create: `codewalk/test/fixtures/sample.ts`
- Modify: `codewalk/.vscode-test.mjs`

This test only runs when `INTEGRATION_TESTS=1` and Ollama is running locally. Used as a smoke check before phase-close demo.

- [ ] **Step 1: Create the fixture file**

Contents of `codewalk/test/fixtures/sample.ts`:
```typescript
// A sample file used by the segmenter integration test.

import { readFileSync } from "node:fs";

interface Config {
  host: string;
  port: number;
}

function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Config>;
  if (typeof parsed.host !== "string") throw new Error("host missing");
  if (typeof parsed.port !== "number") throw new Error("port missing");
  return { host: parsed.host, port: parsed.port };
}

function startServer(config: Config): void {
  console.log(`starting server on ${config.host}:${config.port}`);
}

const cfg = loadConfig("./config.json");
startServer(cfg);
```

- [ ] **Step 2: Write the integration test**

Contents of `codewalk/test/integration/ollamaEndToEnd.test.ts`:
```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, suiteSetup } from "mocha";
import * as vscode from "vscode";
import { segment } from "../../src/engine/segmenter";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../../src/llm/ollamaDetection";

const PROMPTS_DIR = path.join(__dirname, "../../../prompts");

suite("integration: Ollama segmentation", function () {
  this.timeout(120000);

  suiteSetup(function () {
    if (process.env.INTEGRATION_TESTS !== "1") {
      this.skip();
    }
  });

  test("segments a real TypeScript file", async function () {
    const reachable = await isOllamaReachable("http://localhost:11434/v1");
    if (!reachable) this.skip();

    const doc = await vscode.workspace.openTextDocument(
      path.join(__dirname, "../../../test/fixtures/sample.ts"),
    );
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
    });
    const segments = await segment(doc, { adapter, promptsDir: PROMPTS_DIR });
    assert.ok(segments.length >= 2, `expected ≥ 2 segments, got ${segments.length}`);
    for (const seg of segments) {
      assert.ok(seg.startLine >= 1, "startLine ≥ 1");
      assert.ok(seg.endLine >= seg.startLine, "endLine ≥ startLine");
      assert.ok(seg.label.length > 0);
      assert.ok(seg.oneLiner.length > 0);
    }
  });
});
```

- [ ] **Step 3: Update `codewalk/.vscode-test.mjs` to include the integration glob**

Replace the contents:
```javascript
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: [
    "out/test/suite/**/*.test.js",
    "out/test/integration/**/*.test.js",
  ],
  mocha: {
    ui: "tdd",
    timeout: 120000,
    color: true,
  },
});
```

- [ ] **Step 4: Run unit tests to confirm nothing regressed**

```bash
npm test
```
Expected: all unit tests pass; the integration test skips (no env var set).

- [ ] **Step 5: Optional — run the integration test manually**

With Ollama running and `qwen2.5-coder:7b` pulled:
```bash
# PowerShell
$env:INTEGRATION_TESTS=1; npm test
# bash
INTEGRATION_TESTS=1 npm test
```
Expected: the integration test passes. Only do this if you have Ollama set up; otherwise skip to Step 6.

- [ ] **Step 6: Commit**

```bash
git add codewalk/test/integration/ollamaEndToEnd.test.ts codewalk/test/fixtures/sample.ts codewalk/.vscode-test.mjs
git commit -m "phase1/task16: gated integration test against real Ollama"
```

---

## Task 17: Manual verification and phase close

**Files:**
- Modify: `docs/PROJECT_STATE.md`
- Create: `codewalk/README.md`

This task packages the extension, runs the full manual checklist from spec §9.3, fixes any issues found, and closes Phase 1.

- [ ] **Step 1: Create `codewalk/README.md`**

```markdown
# CodeWalk

VS Code extension that turns files into guided, AI-narrated walkthroughs — block by block.

This repo currently implements **Phase 1 — Core Loop**. Running `CodeWalk: Start Walkthrough` on an open file segments it via an LLM and renders clickable CodeLens labels plus difficulty-tinted block backgrounds. Clicking a label is a no-op in Phase 1; expansion arrives in Phase 2.

## Development

```bash
cd codewalk
npm install
npm run build
npm test
```

Press `F5` in VS Code with the `codewalk/` folder open to launch an Extension Development Host with the extension loaded.

## Backends

The shipped default is `ollama-local`. Other supported presets (configurable via `codewalk.backend`): `openrouter`, `groq`, `openai`, `anthropic-oai`, `together`, `custom`. Each preset fills in a sensible `baseUrl` and default `model`; user settings `codewalk.apiKey`, `codewalk.model`, and `codewalk.baseUrl` override where provided.

## Packaging

```bash
cd codewalk
npm run package
```
Produces `codewalk-0.1.0.vsix`.
```

- [ ] **Step 2: Package the extension**

From `codewalk/`:
```bash
npm run package
```
Expected: `codewalk-0.1.0.vsix` created in the `codewalk/` directory.

- [ ] **Step 3: Install the `.vsix` in a fresh VS Code window**

From `codewalk/`:
```bash
code --install-extension codewalk-0.1.0.vsix
```
Open a new VS Code window. Confirm the `CodeWalk: Start Walkthrough` command appears in the command palette.

- [ ] **Step 4: Run manual test checklist**

For each scenario, run it and mark pass/fail. Fix any failures before proceeding to Step 5.

| # | Scenario | Expected | Pass? |
|---|---|---|---|
| 1 | Configure `codewalk.backend = "groq"` with a valid key, open a 50-line TypeScript file, run `Start CodeWalk`. | CodeLens labels + tints appear within ~30 s. | [ ] |
| 2 | Re-run on the same file. | No duplicate lenses, no stale decorations. | [ ] |
| 3 | Close the file, reopen. | No ghost decorations on reopen. | [ ] |
| 4 | Run on an empty file. | Info message "This file is empty — nothing to walk through." No crash. | [ ] |
| 5 | With `codewalk.backend = "groq"` but Wi-Fi disabled, run the command. | Error "CodeWalk couldn't reach the LLM…", Output channel logs `NetworkError`. | [ ] |
| 6 | Set an invalid `codewalk.apiKey` for Groq, run the command. | Error "CodeWalk's API key was rejected" with "Open Settings" button. | [ ] |
| 7 | Stop Ollama, set `codewalk.backend = "ollama-local"`, run the command. | Info "CodeWalk needs an LLM backend…" with "Open Settings" button. No error thrown. | [ ] |
| 8 | Dogfood default (Ollama-local) on a machine with GPU — segment a real file end-to-end. | Works. Verifies the shipped default path. Skip if no GPU available; note in PROJECT_STATE.md. | [ ] |
| 9 | Toggle `codewalk.showBlockHighlights = false`, re-run. | Labels appear, backgrounds do not. | [ ] |

- [ ] **Step 5: Update `docs/PROJECT_STATE.md`**

Replace the file contents (from repo root, not `codewalk/`):

```markdown
# CodeWalk — Project State

**Last updated:** <YYYY-MM-DD>
**Current phase:** Phase 1 — Core Loop (complete)
**Current step:** Phase 1 closed. Ready to start Phase 2 brainstorming.

## Phase status
- [x] Phase 1 — Core Loop (segmenter + CodeLens + block highlights) — **COMPLETE**
- [ ] Phase 2 — Level 1 Explanations (Comment Controller)
- [ ] Phase 3 — Navigation & File Queue
- [ ] Phase 4 — Level 2 & Polish

## Active artifacts
- Phase 1 spec: `docs/superpowers/specs/2026-04-17-codewalk-phase1-core-loop.md`
- Phase 1 plan: `docs/superpowers/plans/2026-04-17-codewalk-phase1-core-loop.md` *(executed)*
- Phase 1 source: `codewalk/`
- ADRs: `docs/ARCHITECTURE_DECISIONS.md` (001, 002, 003 accepted)

## Open questions
None currently. Phase 2 brainstorming will raise new ones.

## Phase 1 manual-test notes
<fill in any deviations, skipped scenarios, or known issues discovered during the Task 17 checklist>

## Recent decisions
<keep prior entries; append any decisions made during Phase 1 execution>

## What's next
1. Begin Phase 2 brainstorming: Comment Controller for expandable explanation panels.
2. Spec location: `docs/superpowers/specs/YYYY-MM-DD-codewalk-phase2-level1-explanations.md`.
```

Fill in the YYYY-MM-DD with today's date and complete the manual-test notes section.

- [ ] **Step 6: Commit final state**

```bash
git add codewalk/README.md docs/PROJECT_STATE.md
# Stage the package-lock.json now that deps are stable
git add codewalk/package-lock.json
git commit -m "phase1/task17: close Phase 1 — manual verification, README, state update"
```

- [ ] **Step 7: Tag the phase**

```bash
git tag phase1-complete
```

---

## Demo acceptance criteria (from spec §12)

All of these must hold before calling Phase 1 done:

1. ✅ Extension packages as a `.vsix` via `vsce package` with no errors. *(Task 17 Step 2)*
2. ✅ Installing the `.vsix` exposes the `Start CodeWalk` command in the palette. *(Task 17 Step 3)*
3. ✅ Running the command on a non-empty file produces CodeLens labels and tints within ~30 s. *(Task 17 Step 4 row 1)*
4. ✅ CodeLens labels match `▶ {Label} — {OneLiner}`. *(Task 12 implementation; verify Task 17 row 1)*
5. ✅ Block backgrounds are tinted and differ by difficulty. *(Task 13 implementation; verify Task 17 row 1)*
6. ✅ Re-running refreshes cleanly — no duplicates. *(Task 17 rows 2–3)*
7. ✅ Each of the manual test scenarios passes. *(Task 17 Step 4)*
8. ✅ All unit tests pass; integration test passes when `INTEGRATION_TESTS=1`. *(Tasks 3–11, 16)*

---

## Self-review (performed after initial draft)

**Spec coverage check:** Every in-scope item from spec §2.1 is covered:
- (1) Extension scaffold → Task 1.
- (2) LLM adapter → Task 7 (interface) + Task 8 (impl).
- (3) Preset system → Task 6.
- (4) First-run UX → Task 14 (the information-message branches in the command).
- (5) Prompt loader → Task 4.
- (6) Segmenter → Task 11.
- (7) In-memory segment store → Task 10.
- (8) CodeLens provider → Task 12.
- (9) Block highlighter → Task 13.
- (10) Start walkthrough command → Task 14.
- (11) Error handling → Task 14 (`handleError` translates typed errors per the §6.1 table).
- (12) Dispose lifecycle → Task 15 (all components registered in `context.subscriptions`).

**Placeholder check:** No TBDs in code steps. The `<YYYY-MM-DD>` and `<fill in…>` placeholders appear only in the Task 17 Step 5 template for the user to fill during execution — these are documentation, not code. One acceptable "Phase 2 will implement" comment sits inside the `codewalk.expandBlock` no-op body — this is factually correct and intentional.

**Type consistency:** `Segment` and `Difficulty` defined in Task 2 are used identically across Tasks 10, 11, 12, 13. `LLMAdapter`, `ChatMessage`, `CompleteOptions`, and the four error classes from Task 7 are referenced consistently in Tasks 8, 11, 14, 16. `UserConfig`, `ResolvedBackend`, `BackendKey` from Task 6 are used in Task 14. `FetchFn` appears in Tasks 8 and 9 with the same shape (`typeof fetch`). `SegmenterDeps.promptsDir` is populated from `context.asAbsolutePath("prompts")` in Task 14 and from fixture paths in test Tasks 11 and 16.

---

## Risks worth naming

- **Network flakiness during Task 17 manual checks** — scenarios 5 and 6 intentionally induce failures. If a real network outage coincides, expected failures will still be observed but the output-channel log may have extra noise. Not a blocker.
- **`fetch` missing on older Node runtimes** — VS Code 1.85+ ships Node 18+ with `fetch` built-in. Package `engines.vscode >= 1.85.0` guards this.
- **Ollama OpenAI-compat endpoint on old versions** — Ollama added `/v1/chat/completions` in v0.1.26 (early 2024). If the user has an older Ollama install, they will see `NetworkError` on the `/v1/chat/completions` path even though `/api/tags` responds. Mitigation: the spec assumes a current Ollama install; note this in README if it surfaces during Task 17.
- **Prompt-quality variance** — small models like `qwen2.5-coder:7b` may return valid JSON with weak semantic segmentation. Phase 1's validation catches shape errors but not *quality*. Quality is a Phase 4 polish concern; Phase 1 closes as long as the pipeline runs end-to-end.
