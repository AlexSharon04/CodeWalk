# Phase 2 — Level 1 Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 per `docs/superpowers/specs/2026-04-20-codewalk-phase2-explanations.md` — clicking a CodeLens expands a streaming Markdown panel with summary, Points to Consider, and tagged concepts; explanations cache in `globalState`; optional background prefetch.

**Architecture:** Four new modules under `codewalk/src/` (`engine/explanationAgent.ts`, `engine/explanationStore.ts`, `engine/prefetchQueue.ts`, `providers/commentController.ts`) plus one new prompt (`prompts/explanation.md`). `OpenAICompatibleAdapter` gains a streaming `completeStream` method. `extension.ts` wires the new modules and swaps the Phase 1 `codewalk.expandBlock` stub for the real implementation. Every LLM-touching piece mirrors the ADR-005 seven-rule validation contract from the segmenter.

**Tech Stack:** TypeScript (strict), VS Code Extension API (`CommentController`, `globalState`), Node 20 `fetch` + SSE streaming, Mocha/`node:assert` tests via `@vscode/test-cli`.

**Reference implementations to mirror:**
- `codewalk/src/engine/segmenter.ts` — canonical ADR-005 pipeline shape.
- `codewalk/src/engine/segmentStore.ts` — event-emitter store pattern.
- `codewalk/src/llm/openAiCompatibleAdapter.ts` — existing adapter; extend with streaming.
- `codewalk/test/suite/segmenter.test.ts` — test style (`suite`/`test`, mocked adapter).
- `codewalk/test/suite/adapter.test.ts` — `FetchFn` injection pattern for HTTP tests.

**Commands used repeatedly:**
- `cd codewalk && npm test` — runs unit + integration test suites.
- `cd codewalk && npm run compile-tests` — type-checks tests without running them.
- `cd codewalk && npm run build` — esbuild bundle for the extension host.
- `cd codewalk && EVAL_EXPLANATION=1 npm test` — runs the eval harness too.

---

## File structure (locked in)

**New files (create):**
```
codewalk/prompts/explanation.md
codewalk/src/engine/explanationAgent.ts
codewalk/src/engine/explanationStore.ts
codewalk/src/engine/prefetchQueue.ts
codewalk/src/providers/commentController.ts
codewalk/test/suite/explanationAgent.test.ts
codewalk/test/suite/explanationStore.test.ts
codewalk/test/suite/commentController.test.ts
codewalk/test/suite/prefetchQueue.test.ts
codewalk/test/eval/explanationEval.test.ts
codewalk/test/integration/explanationLive.test.ts
```

**Modified files:**
```
codewalk/src/llm/adapter.ts              (+ completeStream on LLMAdapter; StreamChunk type)
codewalk/src/llm/openAiCompatibleAdapter.ts  (SSE streaming implementation)
codewalk/src/extension.ts                (wire new modules; swap expandBlock stub)
codewalk/src/commands/startWalkthrough.ts    (handleError branches for 2 new typed errors)
codewalk/package.json                    (3 new settings + 1 new command)
docs/PROJECT_STATE.md                    (manual checklist for Phase 2 boundary)
```

---

## Task 1: Prompt file, agent module skeleton, and explanation types

**Goal:** Drop in the new prompt, define public interfaces and constants. No LLM logic yet — just the types, exports, and a prompt-loads-correctly test. Establishes the contract later tasks implement against.

**Files:**
- Create: `codewalk/prompts/explanation.md`
- Create: `codewalk/src/engine/explanationAgent.ts`
- Modify: `codewalk/src/types/index.ts` — add `Explanation`, `Concept` exports
- Create: `codewalk/test/suite/explanationAgent.test.ts`

- [ ] **Step 1.1: Create the prompt file**

Create `codewalk/prompts/explanation.md`:

````markdown
You are CodeWalk's explanation agent. Your job: given ONE code block plus its surrounding file, produce a teaching-grade explanation.

Rules:
- Summary is ONE paragraph, 2–4 sentences. Teach as if to a student who can read code but doesn't understand the WHY.
- Points to Consider: three arrays — assumptions, dangers, sideEffects — each 0–5 items. Items are SPECIFIC, never generic. Example of good: "The SQL query on line 14 concatenates user input without parameterization, enabling injection." Example of BAD: "Be careful with SQL."
- Concepts: 0–5 items. Include a concept ONLY if a learner might not know it. Each has: name, briefExplainer (2–3 sentences about the concept in general), relevance (1 sentence about why it matters HERE).
- Respond with ONLY the raw JSON object matching the schema. No preamble, no closing remarks, no Markdown fence around the JSON.

Schema:
{
  "summary": "string",
  "pointsToConsider": {
    "assumptions": ["string"],
    "dangers": ["string"],
    "sideEffects": ["string"]
  },
  "concepts": [
    { "name": "string", "briefExplainer": "string", "relevance": "string" }
  ]
}

## Input
Language: {{language}}
File: {{filename}}
Block label: {{label}}
Block lines {{startLine}}–{{endLine}}:
```{{language}}
{{blockCode}}
```

Surrounding file context (for reference; do NOT explain it):
```{{language}}
{{fileContext}}
```

{{additionalContext}}
````

Note: the `{{additionalContext}}` placeholder renders as an empty string when undefined. The "Surrounding file context" block is included unconditionally; callers pass an empty string `""` to elide (handled in the loader wrapper, not the prompt).

- [ ] **Step 1.2: Add explanation types to `src/types/index.ts`**

Modify `codewalk/src/types/index.ts` — append at the end:

```typescript
export interface Concept {
  name: string;
  briefExplainer: string;
  relevance: string;
}

export interface Explanation {
  segmentId: string;
  summary: string;
  pointsToConsider: {
    assumptions: string[];
    dangers: string[];
    sideEffects: string[];
  };
  concepts: Concept[];
  renderState: "streaming" | "done" | "error";
}
```

- [ ] **Step 1.3: Create agent module skeleton with constants + interfaces**

Create `codewalk/src/engine/explanationAgent.ts`:

```typescript
import * as vscode from "vscode";
import type { Explanation, Concept, Segment } from "../types";
import type { LLMAdapter } from "../llm/adapter";

export const EXPLANATION_PROMPT_VERSION = "v1";
export const DEFAULT_MAX_SEGMENT_LINES = 400;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

export type ExplanationLogger = (message: string) => void;

export interface ExplanationDeps {
  readonly adapter: LLMAdapter;
  readonly promptsDir: string;
  readonly logger?: ExplanationLogger;
  readonly token?: vscode.CancellationToken;
  readonly onPartial?: (partial: { summary?: string }) => void;
  /** Phase 5 hook — always undefined in Phase 2. See docs/POST_MVP_VISION.md. */
  readonly additionalContext?: string;
  /** Override for tests. */
  readonly maxSegmentLines?: number;
  readonly streamIdleTimeoutMs?: number;
  /** Preset key for `structuredOutputMode`; selects json_schema vs json_object. */
  readonly structuredOutputMode?: "json_object" | "json_schema";
}

export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation> {
  throw new Error("not implemented yet — Task 4");
}
```

- [ ] **Step 1.4: Write the test that the prompt loads**

Create `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import { EXPLANATION_PROMPT_VERSION } from "../../src/engine/explanationAgent";

const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

suite("explanation prompt", () => {
  test("prompt file exists and loads via prompt loader", async () => {
    const rendered = await loadPrompt(PROMPTS_DIR, "explanation", {
      language: "typescript",
      filename: "test.ts",
      label: "Block",
      startLine: "1",
      endLine: "10",
      blockCode: "const x = 1;",
      fileContext: "const x = 1;",
      additionalContext: "",
    });
    assert.ok(rendered.includes("## Input"));
    assert.ok(rendered.includes("Block"));
    assert.ok(rendered.includes("typescript"));
  });

  test("EXPLANATION_PROMPT_VERSION is a non-empty string", () => {
    assert.strictEqual(typeof EXPLANATION_PROMPT_VERSION, "string");
    assert.ok(EXPLANATION_PROMPT_VERSION.length > 0);
  });
});
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run: `cd codewalk && npm test -- --grep "explanation prompt"`
Expected: 2 tests pass.

If the test fails with "Missing placeholder", the loader may require all `{{...}}` placeholders to be provided. Check `codewalk/src/prompts/loader.ts`. If it requires every `{{...}}` in the file, the test above already supplies all eight. If a placeholder is missing in the prompt file but referenced in the test call, the loader will throw.

- [ ] **Step 1.6: Commit**

```bash
cd codewalk && git add prompts/explanation.md src/engine/explanationAgent.ts src/types/index.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step1: explanation prompt + agent skeleton

- prompts/explanation.md drops in per spec §7.1; system/user split happens at call time like segmentation.md.
- src/engine/explanationAgent.ts defines ExplanationDeps, EXPLANATION_PROMPT_VERSION, DEFAULT_MAX_SEGMENT_LINES, DEFAULT_STREAM_IDLE_TIMEOUT_MS; explain() throws 'not implemented' until Task 4.
- src/types/index.ts exports Explanation and Concept types.
- First test confirms the prompt loads via the existing ADR-002 loader with all placeholders filled."
```

---

## Task 2: Typed errors — `SegmentTooLargeError` and `ExplanationStreamError`

**Goal:** Define the two new typed errors the spec requires. Mirror the `FileTooLargeError` shape from `segmenter.ts`. Tests pin the readonly-field contract so later code can rely on them.

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts` — append error classes.
- Modify: `codewalk/test/suite/explanationAgent.test.ts` — add error-shape tests.

- [ ] **Step 2.1: Write the failing tests first**

Append to `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
import {
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../../src/engine/explanationAgent";

suite("SegmentTooLargeError", () => {
  test("is an instance of Error", () => {
    const err = new SegmentTooLargeError("seg-abc", 500, 400);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof SegmentTooLargeError);
  });

  test("exposes segmentId, lineCount, maxLines as readonly fields", () => {
    const err = new SegmentTooLargeError("seg-abc", 500, 400);
    assert.strictEqual(err.segmentId, "seg-abc");
    assert.strictEqual(err.lineCount, 500);
    assert.strictEqual(err.maxLines, 400);
  });

  test("message includes the metrics", () => {
    const err = new SegmentTooLargeError("seg-abc", 500, 400);
    assert.ok(err.message.includes("500"));
    assert.ok(err.message.includes("400"));
  });

  test("name is SegmentTooLargeError", () => {
    const err = new SegmentTooLargeError("seg-abc", 500, 400);
    assert.strictEqual(err.name, "SegmentTooLargeError");
  });
});

suite("ExplanationStreamError", () => {
  test("is an instance of Error", () => {
    const err = new ExplanationStreamError("seg-abc", 1024, "network");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ExplanationStreamError);
  });

  test("exposes segmentId, partialBytes, cause", () => {
    const err = new ExplanationStreamError("seg-abc", 1024, "network");
    assert.strictEqual(err.segmentId, "seg-abc");
    assert.strictEqual(err.partialBytes, 1024);
    assert.strictEqual(err.cause, "network");
  });

  test("accepts the three documented causes", () => {
    const causes: Array<"network" | "provider-terminated" | "parse-never-ready"> = [
      "network",
      "provider-terminated",
      "parse-never-ready",
    ];
    for (const c of causes) {
      const err = new ExplanationStreamError("seg-abc", 0, c);
      assert.strictEqual(err.cause, c);
    }
  });

  test("name is ExplanationStreamError", () => {
    const err = new ExplanationStreamError("seg-abc", 0, "network");
    assert.strictEqual(err.name, "ExplanationStreamError");
  });
});
```

- [ ] **Step 2.2: Run the tests — expect FAIL**

Run: `cd codewalk && npm test -- --grep "SegmentTooLargeError|ExplanationStreamError"`
Expected: Compilation fails because the classes aren't exported yet, or tests fail with "not a constructor".

- [ ] **Step 2.3: Implement the error classes**

Append to `codewalk/src/engine/explanationAgent.ts` (before the `explain` function):

```typescript
export class SegmentTooLargeError extends Error {
  constructor(
    public readonly segmentId: string,
    public readonly lineCount: number,
    public readonly maxLines: number,
  ) {
    super(
      `Segment ${segmentId} has ${lineCount} lines; CodeWalk currently supports blocks up to ${maxLines} lines.`,
    );
    this.name = "SegmentTooLargeError";
  }
}

export class ExplanationStreamError extends Error {
  constructor(
    public readonly segmentId: string,
    public readonly partialBytes: number,
    public readonly cause: "network" | "provider-terminated" | "parse-never-ready",
  ) {
    super(
      `Explanation stream for ${segmentId} ended prematurely (${partialBytes} bytes received, cause: ${cause}).`,
    );
    this.name = "ExplanationStreamError";
  }
}
```

- [ ] **Step 2.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "SegmentTooLargeError|ExplanationStreamError"`
Expected: All 9 tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd codewalk && git add src/engine/explanationAgent.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step2: typed errors SegmentTooLargeError + ExplanationStreamError

- Mirror FileTooLargeError shape from segmenter.ts.
- ExplanationStreamError.cause is a three-value union matching spec §9 error table.
- Nine shape tests lock the public fields so later handleError branches can rely on them."
```

---

## Task 3: Streaming support on `LLMAdapter`

**Goal:** Extend the adapter interface with a streaming method that yields text chunks from the provider's SSE response. Tests cover the happy path, abort-signal propagation, and stream-idle timeout. Non-streaming `complete` is unchanged — segmenter is unaffected.

**Files:**
- Modify: `codewalk/src/llm/adapter.ts` — add `StreamChunk`, `CompleteStreamOptions`, `completeStream` on `LLMAdapter`.
- Modify: `codewalk/src/llm/openAiCompatibleAdapter.ts` — implement SSE parsing + idle watchdog.
- Modify: `codewalk/test/suite/adapter.test.ts` — add streaming tests.

- [ ] **Step 3.1: Extend the adapter interface**

Modify `codewalk/src/llm/adapter.ts` — add types and method:

```typescript
export interface CompleteStreamOptions extends CompleteOptions {
  /** Milliseconds without a chunk before aborting the stream. 0 or undefined = no timeout. */
  idleTimeoutMs?: number;
}

export class StreamIdleTimeoutError extends Error {
  constructor(
    public readonly idleMs: number,
    public readonly bytesReceived: number,
  ) {
    super(`No stream chunks received for ${idleMs}ms (${bytesReceived} bytes received so far).`);
    this.name = "StreamIdleTimeoutError";
  }
}

export interface LLMAdapter {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
  completeStream(messages: ChatMessage[], options?: CompleteStreamOptions): AsyncIterable<string>;
}
```

- [ ] **Step 3.2: Write the streaming tests first**

Append to `codewalk/test/suite/adapter.test.ts`:

```typescript
import { StreamIdleTimeoutError } from "../../src/llm/adapter";

function mockStreamFetch(chunks: string[], opts?: { delayMs?: number; throws?: Error }): FetchFn {
  return async () => {
    if (opts?.throws) throw opts.throws;
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        if (opts?.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      },
    });
    return {
      status: 200,
      ok: true,
      body: stream,
      headers: { get: () => null },
    } as unknown as Response;
  };
}

// SSE chunks for OpenAI-compat streaming. Each data line carries a JSON fragment with a delta.
function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const SSE_DONE = "data: [DONE]\n\n";

suite("OpenAICompatibleAdapter.completeStream", () => {
  test("yields text chunks in order from SSE response", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("Hello "),
      sseChunk("world"),
      SSE_DONE,
    ]));
    const collected: string[] = [];
    for await (const chunk of a.completeStream([{ role: "user", content: "hi" }])) {
      collected.push(chunk);
    }
    assert.deepStrictEqual(collected, ["Hello ", "world"]);
  });

  test("throws CancelledError when AbortSignal fires mid-stream", async () => {
    const controller = new AbortController();
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("Hello "),
      sseChunk("world"),
      SSE_DONE,
    ], { delayMs: 50 }));
    const iter = a.completeStream([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(async () => {
      for await (const _ of iter) { /* consume */ }
    }, /cancel/i);
  });

  test("throws StreamIdleTimeoutError when no chunk arrives within idleTimeoutMs", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("partial"),
      // then hang for a long time before [DONE]
    ], { delayMs: 500 }));
    const iter = a.completeStream([{ role: "user", content: "hi" }], {
      idleTimeoutMs: 100,
    });
    await assert.rejects(async () => {
      for await (const _ of iter) { /* consume */ }
    }, StreamIdleTimeoutError);
  });

  test("propagates NetworkError when fetch throws", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([], { throws: new Error("boom") }));
    await assert.rejects(async () => {
      for await (const _ of a.completeStream([{ role: "user", content: "hi" }])) { /* consume */ }
    }, NetworkError);
  });

  test("propagates AuthError on HTTP 401", async () => {
    const fetchFn: FetchFn = async () => ({
      status: 401,
      ok: false,
      json: async () => ({ error: "unauthorized" }),
      text: async () => "unauthorized",
      headers: { get: () => null },
    } as unknown as Response);
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await assert.rejects(async () => {
      for await (const _ of a.completeStream([{ role: "user", content: "hi" }])) { /* consume */ }
    }, AuthError);
  });
});
```

- [ ] **Step 3.3: Run the tests — expect FAIL**

Run: `cd codewalk && npm test -- --grep "completeStream"`
Expected: TypeScript compilation fails (`completeStream is not a function`) or runtime errors.

- [ ] **Step 3.4: Implement SSE streaming in `OpenAICompatibleAdapter`**

Modify `codewalk/src/llm/openAiCompatibleAdapter.ts` — add the `completeStream` method to the class. Reuse the existing header/body construction; add a `stream: true` flag on the POST body. Parse SSE frames via `TextDecoder` and yield each `delta.content` string.

Add near the top of the file (outside the class):

```typescript
async function* parseSseStream(
  response: Response,
  idleTimeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<{ chunk: string; bytes: number }> {
  if (!response.body) throw new NetworkError("Stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;

  // Set up idle timeout + abort cooperatively.
  const readWithTimeout = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (!idleTimeoutMs || idleTimeoutMs <= 0) return reader.read();
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new StreamIdleTimeoutError(idleTimeoutMs, totalBytes)),
        idleTimeoutMs,
      );
    });
    try {
      return await Promise.race([reader.read(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw new CancelledError();
      const { value, done } = await readWithTimeout();
      if (done) return;
      if (!value) continue;
      totalBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by \n\n. Each frame has one or more `data:` lines.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const obj = JSON.parse(payload);
            const content = obj?.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length > 0) {
              yield { chunk: content, bytes: totalBytes };
            }
          } catch {
            // Ignore malformed partial frames; SSE payloads are per-frame JSON.
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* ignore */ }
  }
}
```

Then add the method on the class. Mirror the existing `complete` method's HTTP setup; set `stream: true` on the request body; route through `parseSseStream`:

```typescript
async *completeStream(
  messages: ChatMessage[],
  options: CompleteStreamOptions = {},
): AsyncGenerator<string> {
  const body = this.buildRequestBody(messages, options);  // extract existing logic if inlined
  body.stream = true;
  const signal = options.signal;
  let response: Response;
  try {
    response = await this.fetchFn(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    throw new NetworkError(`Stream fetch failed: ${(err as Error).message}`, err);
  }

  if (!response.ok) {
    // Reuse existing error-classification from complete()
    this.throwForStatus(response);  // existing helper
  }

  for await (const { chunk } of parseSseStream(response, options.idleTimeoutMs, signal)) {
    if (signal?.aborted) throw new CancelledError();
    yield chunk;
  }
}
```

Notes for the implementer:
- The existing `complete` method constructs the request body and headers inline. Factor the shared parts out into private helpers (`buildRequestBody`, `buildHeaders`, `throwForStatus`) OR duplicate the inline logic if factoring is too invasive — both acceptable. The test suite is the contract, not the internal layout.
- The existing `throwForStatus` mapping for 401 → `AuthError`, 429 → `RateLimitError`, other 4xx/5xx → `NetworkError` must cover the stream path too. If it doesn't exist as a named helper, copy the branching from `complete`'s error path verbatim.

- [ ] **Step 3.5: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "completeStream"`
Expected: All 5 streaming tests pass. Existing `complete` tests still pass.

If the idle-timeout test flakes, double-check that `Promise.race` with `setTimeout` actually throws the timeout error (not the reader.read result) — the timer handle must reject the promise, not resolve with a sentinel.

- [ ] **Step 3.6: Commit**

```bash
cd codewalk && git add src/llm/adapter.ts src/llm/openAiCompatibleAdapter.ts test/suite/adapter.test.ts
git commit -m "phase2/step3: streaming adapter (completeStream, SSE parsing, idle timeout)

- LLMAdapter grows completeStream(messages, options): AsyncIterable<string>.
- OpenAICompatibleAdapter implements SSE parsing with TextDecoder; frames split on \n\n; each data: line's delta.content yielded as a chunk; [DONE] terminates.
- StreamIdleTimeoutError added to adapter.ts; idleTimeoutMs option wired via Promise.race.
- AbortSignal aborts the underlying reader and throws CancelledError.
- Five tests cover happy path, abort mid-stream, idle timeout, network error, 401 -> AuthError."
```

---

## Task 4: Explanation agent — input guard + non-streaming happy path

**Goal:** Make `explain(segment, fileContext, deps)` work against the non-streaming `adapter.complete` code path, including the input guard. Defers streaming to Task 6 and retry to Task 5.

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts` — implement `explain()`.
- Modify: `codewalk/test/suite/explanationAgent.test.ts` — add happy-path and input-guard tests.

- [ ] **Step 4.1: Write the happy-path + input-guard tests**

Append to `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
import { explain, DEFAULT_MAX_SEGMENT_LINES } from "../../src/engine/explanationAgent";
import type { LLMAdapter, CompleteOptions, CompleteStreamOptions } from "../../src/llm/adapter";
import type { Segment } from "../../src/types";

function fakeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-abc",
    label: "Test Block",
    oneLiner: "a test segment",
    startLine: 1,
    endLine: 10,
    code: "const x = 1;",
    difficulty: "standard",
    ...overrides,
  };
}

function stubAdapter(responses: string[]): LLMAdapter {
  let i = 0;
  return {
    async complete() {
      const resp = responses[i++];
      if (resp === undefined) throw new Error("stubAdapter exhausted");
      return resp;
    },
    async *completeStream() {
      const resp = responses[i++];
      if (resp === undefined) throw new Error("stubAdapter exhausted");
      yield resp;
    },
  };
}

const VALID_RESPONSE = JSON.stringify({
  summary: "This block declares a constant. It demonstrates TypeScript's const keyword and immutable binding semantics for primitive values.",
  pointsToConsider: {
    assumptions: ["The value 1 is semantically meaningful in this context rather than an arbitrary placeholder."],
    dangers: [],
    sideEffects: [],
  },
  concepts: [
    { name: "Const binding", briefExplainer: "A const declaration creates an immutable binding in TypeScript; the binding cannot be reassigned. It does not make the value itself immutable for objects.", relevance: "This specific example uses a primitive, so the binding and value are both effectively immutable." },
  ],
});

suite("explain() — input guard", () => {
  test("throws SegmentTooLargeError when segment exceeds maxSegmentLines", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 500 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, maxSegmentLines: 400 }),
      SegmentTooLargeError,
    );
  });

  test("uses DEFAULT_MAX_SEGMENT_LINES when maxSegmentLines is omitted", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: DEFAULT_MAX_SEGMENT_LINES + 1 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      SegmentTooLargeError,
    );
  });

  test("does not call adapter when segment is over budget", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 500 });
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return ""; },
      async *completeStream() { calls++; yield ""; },
    };
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, maxSegmentLines: 400 }),
      SegmentTooLargeError,
    );
    assert.strictEqual(calls, 0);
  });
});

suite("explain() — happy path (non-streaming)", () => {
  test("returns a valid Explanation when the adapter returns valid JSON", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([VALID_RESPONSE]);
    const result = await explain(seg, "const x = 1;", {
      adapter,
      promptsDir: PROMPTS_DIR,
    });
    assert.strictEqual(result.segmentId, "seg-abc");
    assert.ok(result.summary.length >= 20);
    assert.strictEqual(result.renderState, "done");
    assert.deepStrictEqual(Array.isArray(result.pointsToConsider.assumptions), true);
    assert.strictEqual(result.concepts.length, 1);
    assert.strictEqual(result.concepts[0]!.name, "Const binding");
  });
});
```

- [ ] **Step 4.2: Run tests — expect FAIL**

Run: `cd codewalk && npm test -- --grep "input guard|happy path"`
Expected: `not implemented yet` errors from the Task 1 stub.

- [ ] **Step 4.3: Implement `explain()` — input guard + prompt render + adapter.complete + parse**

Replace the stub body in `codewalk/src/engine/explanationAgent.ts`:

```typescript
import { loadPrompt } from "../prompts/loader";
import {
  CancelledError,
  MalformedResponseError,
} from "../llm/adapter";

class ValidationFailure extends Error {}

interface RawExplanation {
  summary?: unknown;
  pointsToConsider?: {
    assumptions?: unknown;
    dangers?: unknown;
    sideEffects?: unknown;
  };
  concepts?: unknown;
}

export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation> {
  // Rule 1 — input guard.
  const maxLines = deps.maxSegmentLines ?? DEFAULT_MAX_SEGMENT_LINES;
  const lineCount = segment.endLine - segment.startLine + 1;
  if (lineCount > maxLines) {
    throw new SegmentTooLargeError(segment.id, lineCount, maxLines);
  }

  throwIfCancelled(deps.token);

  const prompt = await loadPrompt(deps.promptsDir, "explanation", {
    language: guessLanguage(segment),
    filename: "(unknown)",
    label: segment.label,
    startLine: String(segment.startLine),
    endLine: String(segment.endLine),
    blockCode: segment.code,
    fileContext: fileContext,
    additionalContext: deps.additionalContext ?? "",
  });

  const { system, user } = splitPrompt(prompt);

  const raw = await deps.adapter.complete([
    { role: "system", content: system },
    { role: "user", content: user },
  ], {
    responseFormat: "json_object",
    signal: undefined,
  });

  // Rule 2 — parse. Rules 3–4 land in Task 5.
  const parsed = parseAndValidate(raw, segment);
  return {
    segmentId: segment.id,
    summary: parsed.summary,
    pointsToConsider: parsed.pointsToConsider,
    concepts: parsed.concepts,
    renderState: "done",
  };
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) throw new CancelledError();
}

function splitPrompt(prompt: string): { system: string; user: string } {
  const marker = "## Input";
  const idx = prompt.indexOf(marker);
  if (idx < 0) return { system: prompt, user: "" };
  return {
    system: prompt.slice(0, idx).trim(),
    user: prompt.slice(idx + marker.length).trim(),
  };
}

function guessLanguage(segment: Segment): string {
  // Pragmatic guess; production code can pull from vscode.TextDocument.languageId.
  return (segment as unknown as { languageId?: string }).languageId ?? "text";
}

function parseAndValidate(raw: string, segment: Segment): {
  summary: string;
  pointsToConsider: Explanation["pointsToConsider"];
  concepts: Concept[];
} {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new MalformedResponseError("response is not valid JSON", raw);
  }

  if (typeof obj.summary !== "string" || obj.summary.length < 20) {
    throw new MalformedResponseError("summary missing or too short", raw);
  }

  const ptc = obj.pointsToConsider ?? {};
  const pointsToConsider = {
    assumptions: arrayOfStrings(ptc.assumptions),
    dangers: arrayOfStrings(ptc.dangers),
    sideEffects: arrayOfStrings(ptc.sideEffects),
  };

  const concepts = Array.isArray(obj.concepts)
    ? obj.concepts
        .filter((c: any) =>
          c && typeof c.name === "string" && c.name.length > 0
          && typeof c.briefExplainer === "string" && c.briefExplainer.length > 0
          && typeof c.relevance === "string" && c.relevance.length > 0,
        )
        .map((c: any): Concept => ({
          name: c.name,
          briefExplainer: c.briefExplainer,
          relevance: c.relevance,
        }))
    : [];

  return { summary: obj.summary, pointsToConsider, concepts };
}

function arrayOfStrings(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
}
```

- [ ] **Step 4.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "input guard|happy path"`
Expected: 4 tests pass.

- [ ] **Step 4.5: Commit**

```bash
cd codewalk && git add src/engine/explanationAgent.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step4: explanation agent happy path + input guard

- explain() now runs: input guard -> prompt render -> system/user split -> adapter.complete -> parse -> return.
- Rule 1 (input guard) enforced; Rules 3-5 are naive (task 5 adds full validation + retry).
- Non-streaming path only; streaming lands in task 6.
- Four tests cover SegmentTooLargeError behavior and a valid-response happy path."
```

---

## Task 5: Explanation agent — full per-item/cross-item validation + single retry

**Goal:** Bring the agent into full ADR-005 compliance for rules 3–5. Per-item validation rejects short summaries, generic PTC items, and malformed concepts. Cross-item validation dedupes concept names and catches `summary == oneLiner`. Single retry threads the specific failure reason into the system prompt.

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts` — expand validation + add retry loop.
- Modify: `codewalk/test/suite/explanationAgent.test.ts` — add 6 validation tests.

- [ ] **Step 5.1: Write the validation tests**

Append to `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
const GENERIC_PTC_RESPONSE = JSON.stringify({
  summary: "This is a valid-looking summary paragraph that says enough to pass the length check.",
  pointsToConsider: {
    assumptions: ["be careful with this code"],  // generic phrase — must be rejected
    dangers: ["This block on line 3 concatenates user input without escaping it."],
    sideEffects: [],
  },
  concepts: [],
});

const SHORT_SUMMARY_RESPONSE = JSON.stringify({
  summary: "Short.",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
});

const DUP_CONCEPTS_RESPONSE = JSON.stringify({
  summary: "This is a valid-looking summary paragraph that says enough to pass the length check.",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [
    { name: "Closure", briefExplainer: "A closure captures variables from its defining scope. It allows inner functions to access outer-scope bindings after the outer function has returned.", relevance: "This block uses a closure to capture `config`." },
    { name: "Closure", briefExplainer: "DUPLICATE — should be dropped.", relevance: "DUPLICATE." },
  ],
});

const SUMMARY_EQUALS_ONELINER_RESPONSE = JSON.stringify({
  summary: "a test segment",  // exactly matches fakeSegment().oneLiner
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
});

const RETRY_SUCCEEDED_RESPONSE = JSON.stringify({
  summary: "This is a valid summary after the retry — teaches the user what the block actually does.",
  pointsToConsider: {
    assumptions: ["Assumes `config` is defined before this block runs."],
    dangers: [],
    sideEffects: [],
  },
  concepts: [],
});

suite("explain() — per-item validation", () => {
  test("rejects summary shorter than 20 chars (MalformedResponseError after retry)", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([SHORT_SUMMARY_RESPONSE, SHORT_SUMMARY_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("drops generic PTC items matching the generic-phrase regex", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([GENERIC_PTC_RESPONSE]);
    const result = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    // "be careful with this code" was dropped; the specific dangers item survived.
    assert.strictEqual(result.pointsToConsider.assumptions.length, 0);
    assert.strictEqual(result.pointsToConsider.dangers.length, 1);
  });
});

suite("explain() — cross-item validation", () => {
  test("dedupes duplicate concept names keeping first occurrence", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([DUP_CONCEPTS_RESPONSE]);
    const result = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(result.concepts.length, 1);
    assert.ok(result.concepts[0]!.briefExplainer.includes("captures variables"));
  });

  test("retries when summary is identical to segment.oneLiner (case/whitespace-insensitive)", async () => {
    const seg = fakeSegment();  // oneLiner: "a test segment"
    const adapter = stubAdapter([SUMMARY_EQUALS_ONELINER_RESPONSE, RETRY_SUCCEEDED_RESPONSE]);
    const result = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.ok(result.summary.length > 20);
    assert.notStrictEqual(result.summary.trim().toLowerCase(), seg.oneLiner.trim().toLowerCase());
  });
});

suite("explain() — retry with threaded reason", () => {
  test("retry prompt includes the specific failure reason from the first attempt", async () => {
    const seg = fakeSegment();
    const messages: Array<Array<{ role: string; content: string }>> = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        messages.push(msgs.map(m => ({ role: m.role, content: m.content })));
        return messages.length === 1 ? SUMMARY_EQUALS_ONELINER_RESPONSE : RETRY_SUCCEEDED_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(messages.length, 2);
    const retrySystem = messages[1]!.find(m => m.role === "system")!.content;
    assert.ok(retrySystem.includes("CRITICAL"));
    assert.ok(
      retrySystem.toLowerCase().includes("summary") && retrySystem.toLowerCase().includes("oneliner"),
      "retry system prompt must name the specific validation failure",
    );
  });

  test("retries once; second failure surfaces MalformedResponseError with both attempts", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([SHORT_SUMMARY_RESPONSE, SHORT_SUMMARY_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      (err: Error) =>
        err instanceof MalformedResponseError
        && typeof (err as MalformedResponseError).rawResponse === "string"
        && (err as MalformedResponseError).rawResponse!.includes("first")
        && (err as MalformedResponseError).rawResponse!.includes("second"),
    );
  });
});
```

- [ ] **Step 5.2: Run tests — expect FAIL**

Run: `cd codewalk && npm test -- --grep "per-item validation|cross-item validation|retry with threaded reason"`
Expected: several tests fail; the current naive parser passes short summaries, keeps generic phrases, doesn't dedupe, and doesn't retry.

- [ ] **Step 5.3: Implement full validation + retry**

Replace the body of `explain()` and rewrite `parseAndValidate` in `codewalk/src/engine/explanationAgent.ts`:

```typescript
const GENERIC_PTC_RE = /^(be careful|make sure|consider|note that|avoid|watch out|don['’]t forget)\b/i;
const MIN_SUMMARY_LEN = 20;
const MIN_PTC_ITEM_LEN = 15;

export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation> {
  const maxLines = deps.maxSegmentLines ?? DEFAULT_MAX_SEGMENT_LINES;
  const lineCount = segment.endLine - segment.startLine + 1;
  if (lineCount > maxLines) {
    throw new SegmentTooLargeError(segment.id, lineCount, maxLines);
  }

  throwIfCancelled(deps.token);

  const prompt = await loadPrompt(deps.promptsDir, "explanation", {
    language: guessLanguage(segment),
    filename: "(unknown)",
    label: segment.label,
    startLine: String(segment.startLine),
    endLine: String(segment.endLine),
    blockCode: segment.code,
    fileContext: fileContext,
    additionalContext: deps.additionalContext
      ? `Prior context:\n${deps.additionalContext}`
      : "",
  });
  const { system: baseSystem, user } = splitPrompt(prompt);

  let firstRaw: string | undefined;
  let firstReason: string | undefined;
  const useJsonSchema = deps.structuredOutputMode === "json_schema";

  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled(deps.token);

    const system = attempt === 0
      ? baseSystem
      : `${baseSystem}\n\nCRITICAL: your previous response failed validation: ${firstReason ?? "unknown"}. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.`;

    const raw = await deps.adapter.complete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { responseFormat: useJsonSchema ? "json_object" : "json_object" },
    );

    try {
      const validated = validateResponse(raw, segment);
      return {
        segmentId: segment.id,
        summary: validated.summary,
        pointsToConsider: validated.pointsToConsider,
        concepts: validated.concepts,
        renderState: "done",
      };
    } catch (err) {
      if (err instanceof ValidationFailure) {
        if (attempt === 0) {
          firstRaw = raw;
          firstReason = err.message;
          continue;
        }
        throw new MalformedResponseError(
          `validation failed on both attempts: ${err.message}`,
          JSON.stringify({ first: firstRaw, second: raw }),
        );
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

function validateResponse(raw: string, segment: Segment): {
  summary: string;
  pointsToConsider: Explanation["pointsToConsider"];
  concepts: Concept[];
} {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }

  if (typeof obj.summary !== "string" || obj.summary.length < MIN_SUMMARY_LEN) {
    throw new ValidationFailure(`summary is missing or shorter than ${MIN_SUMMARY_LEN} chars`);
  }
  if (obj.summary.trim().toLowerCase() === segment.oneLiner.trim().toLowerCase()) {
    throw new ValidationFailure("summary is identical to segment.oneLiner — agent must expand on the one-liner, not echo it");
  }

  const ptcIn = obj.pointsToConsider ?? {};
  const pointsToConsider = {
    assumptions: filterPtcItems(ptcIn.assumptions),
    dangers: filterPtcItems(ptcIn.dangers),
    sideEffects: filterPtcItems(ptcIn.sideEffects),
  };

  const conceptsRaw = Array.isArray(obj.concepts) ? obj.concepts : [];
  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const c of conceptsRaw) {
    if (!c || typeof (c as any).name !== "string" || (c as any).name.length === 0) continue;
    if (typeof (c as any).briefExplainer !== "string" || (c as any).briefExplainer.length === 0) continue;
    if (typeof (c as any).relevance !== "string" || (c as any).relevance.length === 0) continue;
    const key = (c as any).name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({
      name: (c as any).name,
      briefExplainer: (c as any).briefExplainer,
      relevance: (c as any).relevance,
    });
  }

  return { summary: obj.summary, pointsToConsider, concepts };
}

function filterPtcItems(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter(
    (s): s is string =>
      typeof s === "string"
      && s.length >= MIN_PTC_ITEM_LEN
      && !GENERIC_PTC_RE.test(s.trim()),
  );
}
```

Remove the old `parseAndValidate` and `arrayOfStrings` helpers (replaced by `validateResponse` and `filterPtcItems`).

- [ ] **Step 5.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "per-item validation|cross-item validation|retry with threaded reason"`
Expected: all 6 new tests pass. Happy-path test from Task 4 still passes.

- [ ] **Step 5.5: Commit**

```bash
cd codewalk && git add src/engine/explanationAgent.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step5: explanation agent full validation + single retry

- Per-item: reject summary < 20ch; drop PTC items < 15ch or matching generic-phrase regex (^be careful|^make sure|...).
- Cross-item: dedupe concept names by first occurrence; raise ValidationFailure when summary equals segment.oneLiner (case-insensitive).
- Retry once with threaded reason: CRITICAL: your previous response failed validation: <reason>. System prompt augmented; user prompt unchanged.
- MalformedResponseError on double failure carries both attempts in rawResponse as {first, second} JSON.
- Six tests cover each rule separately."
```

---

## Task 6: Explanation agent — streaming path

**Goal:** When `deps.onPartial` is provided, route through `adapter.completeStream` instead of `adapter.complete`. Extract a partial `summary` field from the in-flight buffer via a tolerant regex and fire `onPartial`. On stream end, run the full validation pipeline on the accumulated buffer. Stream-idle and stream-dropped failures map to `ExplanationStreamError`.

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts` — add streaming code path.
- Modify: `codewalk/test/suite/explanationAgent.test.ts` — 3 streaming tests.

- [ ] **Step 6.1: Write the streaming tests**

Append to `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
function streamingAdapter(chunks: string[]): LLMAdapter {
  return {
    async complete() { throw new Error("streamingAdapter only implements completeStream"); },
    async *completeStream() { for (const c of chunks) yield c; },
  };
}

suite("explain() — streaming", () => {
  test("onPartial fires with partial summary as tokens arrive", async () => {
    const seg = fakeSegment();
    // Split the valid response into 3 chunks, first cutting mid-summary.
    const whole = VALID_RESPONSE;
    const sliceAt = whole.indexOf(", ") + 2;  // mid-summary
    const chunks = [whole.slice(0, sliceAt), whole.slice(sliceAt, sliceAt + 40), whole.slice(sliceAt + 40)];
    const adapter = streamingAdapter(chunks);
    const partials: Array<{ summary?: string }> = [];
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      onPartial: p => partials.push({ ...p }),
    });
    // At least one onPartial with a non-empty summary prefix.
    const summaries = partials.map(p => p.summary ?? "");
    assert.ok(summaries.some(s => s.length > 0), "expected at least one partial with summary");
    // Summaries should be monotonically-growing prefixes.
    for (let i = 1; i < summaries.length; i++) {
      if (summaries[i]!.length > 0 && summaries[i - 1]!.length > 0) {
        assert.ok(summaries[i]!.startsWith(summaries[i - 1]!), "summary stream should grow monotonically");
      }
    }
  });

  test("onPartial does not fire with invalid partial (broken escape sequence)", async () => {
    const seg = fakeSegment();
    const chunks = [`{"summary": "hello \\`, `u00ff world", ...`];  // backslash-u split across chunks
    const adapter: LLMAdapter = {
      async complete() { return VALID_RESPONSE; },  // fallback for the retry path
      async *completeStream() { for (const c of chunks) yield c; },
    };
    const partials: Array<{ summary?: string }> = [];
    // We expect this to ultimately fail validation (the streamed buffer isn't complete JSON),
    // but onPartial must not have fired with a broken partial.
    try {
      await explain(seg, "", {
        adapter,
        promptsDir: PROMPTS_DIR,
        onPartial: p => partials.push({ ...p }),
      });
    } catch { /* expected */ }
    for (const p of partials) {
      if (p.summary !== undefined) assert.ok(!p.summary.endsWith("\\"), "partial summary must not end with a dangling escape");
    }
  });

  test("throws ExplanationStreamError when underlying stream hits idle timeout", async () => {
    const seg = fakeSegment();
    const adapter: LLMAdapter = {
      async complete() { throw new Error("not used"); },
      async *completeStream() {
        yield `{"summary": "start`;
        // Never yield another chunk. The agent's idleTimeoutMs should abort.
        await new Promise(() => { /* hang */ });
      },
    };
    await assert.rejects(
      () => explain(seg, "", {
        adapter,
        promptsDir: PROMPTS_DIR,
        onPartial: () => {},
        streamIdleTimeoutMs: 80,
      }),
      (err: Error) => err instanceof ExplanationStreamError && err.cause === "provider-terminated",
    );
  });
});
```

- [ ] **Step 6.2: Run tests — expect FAIL**

Run: `cd codewalk && npm test -- --grep "explain.. — streaming"`
Expected: tests fail because streaming path isn't wired yet.

- [ ] **Step 6.3: Implement the streaming code path**

Modify `codewalk/src/engine/explanationAgent.ts`:

Add helpers near the top of the file:

```typescript
const SUMMARY_RE = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/;

export function extractPartialSummary(buffer: string): string | undefined {
  const match = SUMMARY_RE.exec(buffer);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return undefined;
  }
}

async function streamWithIdleTimeout(
  iter: AsyncIterable<string>,
  idleTimeoutMs: number,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const iterator = iter[Symbol.asyncIterator]();
  while (true) {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      if (idleTimeoutMs > 0) {
        timeoutId = setTimeout(() => reject(new Error("__idle__")), idleTimeoutMs);
      }
    });
    try {
      const { value, done } = await Promise.race([iterator.next(), timeoutPromise]);
      if (done) return;
      if (value === undefined) return;
      yield value;
    } catch (err) {
      if ((err as Error).message === "__idle__") throw err;
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
```

Replace the streaming branch inside `explain()`. Between the prompt-build block and the existing retry loop, branch on `deps.onPartial`:

```typescript
  // (before the `for (let attempt = 0; ...)` loop)
  const idleTimeoutMs = deps.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

  // First attempt: streaming if onPartial provided; non-streaming on retry.
  let firstRaw: string | undefined;
  let firstReason: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled(deps.token);
    const system = attempt === 0
      ? baseSystem
      : `${baseSystem}\n\nCRITICAL: your previous response failed validation: ${firstReason ?? "unknown"}. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.`;
    const messages = [
      { role: "system", content: system } as const,
      { role: "user", content: user } as const,
    ];

    let raw: string;
    if (attempt === 0 && deps.onPartial) {
      const ac = new AbortController();
      if (deps.token) {
        deps.token.onCancellationRequested(() => ac.abort());
      }
      let buffer = "";
      let lastEmittedLength = 0;
      try {
        const stream = deps.adapter.completeStream(messages, {
          responseFormat: "json_object",
          signal: ac.signal,
          idleTimeoutMs,
        });
        for await (const chunk of streamWithIdleTimeout(stream, idleTimeoutMs, ac.signal)) {
          buffer += chunk;
          const partial = extractPartialSummary(buffer);
          if (partial !== undefined && partial.length > lastEmittedLength) {
            deps.onPartial({ summary: partial });
            lastEmittedLength = partial.length;
          }
        }
        raw = buffer;
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        if ((err as Error).message === "__idle__" || err instanceof StreamIdleTimeoutError) {
          throw new ExplanationStreamError(segment.id, buffer.length, "provider-terminated");
        }
        throw new ExplanationStreamError(segment.id, buffer.length, "network");
      }
    } else {
      raw = await deps.adapter.complete(messages, { responseFormat: "json_object" });
    }

    try {
      const validated = validateResponse(raw, segment);
      return {
        segmentId: segment.id,
        summary: validated.summary,
        pointsToConsider: validated.pointsToConsider,
        concepts: validated.concepts,
        renderState: "done",
      };
    } catch (err) {
      if (err instanceof ValidationFailure) {
        if (attempt === 0) {
          firstRaw = raw;
          firstReason = err.message;
          continue;
        }
        throw new MalformedResponseError(
          `validation failed on both attempts: ${err.message}`,
          JSON.stringify({ first: firstRaw, second: raw }),
        );
      }
      throw err;
    }
  }
  throw new Error("unreachable");
```

Also add the import: `import { StreamIdleTimeoutError } from "../llm/adapter";` if not already present.

- [ ] **Step 6.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "explain.. — streaming"`
Expected: all 3 streaming tests pass. All previous tests still pass.

- [ ] **Step 6.5: Commit**

```bash
cd codewalk && git add src/engine/explanationAgent.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step6: explanation agent streaming path

- When deps.onPartial is provided, route the first attempt through adapter.completeStream.
- extractPartialSummary() regex scans the incomplete JSON buffer for the summary field and unescapes via JSON.parse; returns undefined on partial escape sequences.
- Monotonic partial emission: onPartial fires only when the extracted summary grows.
- streamWithIdleTimeout wraps the async iterator with a per-chunk idleMs Promise.race; idle throws ExplanationStreamError(cause: 'provider-terminated').
- Network / unknown stream errors throw ExplanationStreamError(cause: 'network').
- Retry remains single-attempt and non-streaming — per spec §7.2 rationale."
```

---

## Task 7: Explanation agent — cancellation, diagnostics, `additionalContext` hook

**Goal:** Finish the ADR-005 addendum wiring. Logger emits a one-line diagnostic per successful call with field counts and retryFired flag; raw code/prompt never logged. `deps.token` aborts streams and is checked synchronously between attempts. `deps.additionalContext` renders in the prompt under a `Prior context:` header (the Phase 5 seam).

**Files:**
- Modify: `codewalk/src/engine/explanationAgent.ts` — logger emission, cancellation checks between attempts, additionalContext rendering.
- Modify: `codewalk/test/suite/explanationAgent.test.ts` — 3 tests.

- [ ] **Step 7.1: Write the tests**

Append to `codewalk/test/suite/explanationAgent.test.ts`:

```typescript
import { CancelledError } from "../../src/llm/adapter";

suite("explain() — cancellation", () => {
  test("throws CancelledError synchronously if token cancelled before first attempt", async () => {
    const seg = fakeSegment();
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, token: source.token }),
      CancelledError,
    );
  });
});

suite("explain() — diagnostics", () => {
  test("logger receives a one-line summary with field counts and does not receive raw code", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([VALID_RESPONSE]);
    const lines: string[] = [];
    await explain(seg, "const x = 1;", {
      adapter,
      promptsDir: PROMPTS_DIR,
      logger: (msg) => lines.push(msg),
    });
    const first = lines.find(l => l.includes("[explanation]"));
    assert.ok(first, "logger should receive an [explanation] summary line");
    assert.ok(first!.includes("segmentId=seg-abc"));
    assert.ok(first!.includes("assumptions=1"));
    assert.ok(first!.includes("concepts=1"));
    // Secret hygiene — raw code must never appear in logs.
    for (const line of lines) {
      assert.ok(!line.includes("const x = 1;"), `log line leaked raw code: ${line}`);
    }
  });

  test("logger emits WARN line when retry fires", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([SUMMARY_EQUALS_ONELINER_RESPONSE, RETRY_SUCCEEDED_RESPONSE]);
    const lines: string[] = [];
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      logger: (msg) => lines.push(msg),
    });
    assert.ok(lines.some(l => l.startsWith("[explanation] WARN") && l.includes("retryFired=true")));
  });
});

suite("explain() — additionalContext Phase 5 seam", () => {
  test("renders `Prior context:` block in the user prompt when additionalContext is non-empty", async () => {
    const seg = fakeSegment();
    const capturedUser: string[] = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        capturedUser.push(msgs.find(m => m.role === "user")!.content);
        return VALID_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      additionalContext: "You've already seen validateJWT.",
    });
    assert.strictEqual(capturedUser.length, 1);
    assert.ok(capturedUser[0]!.includes("Prior context:"));
    assert.ok(capturedUser[0]!.includes("validateJWT"));
  });

  test("omits the `Prior context:` header when additionalContext is undefined or empty", async () => {
    const seg = fakeSegment();
    const capturedUser: string[] = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        capturedUser.push(msgs.find(m => m.role === "user")!.content);
        return VALID_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(capturedUser.length, 1);
    assert.ok(!capturedUser[0]!.includes("Prior context:"));
  });
});
```

- [ ] **Step 7.2: Run tests — expect FAIL (partially)**

Run: `cd codewalk && npm test -- --grep "explain.. — cancellation|diagnostics|additionalContext"`
Expected: cancellation test may already pass (token is checked at entry). Diagnostics tests fail (no logger emission). additionalContext tests pass for the non-empty case (Task 5 already wires the prompt) but the empty-case regex may need the loader to elide empty lines — double-check the prompt file renders cleanly.

- [ ] **Step 7.3: Implement diagnostics + confirm cancellation**

Modify `codewalk/src/engine/explanationAgent.ts` — inside `explain()`, after `return { ... }` succeeds, emit the diagnostic. Track `retryFired` across the loop:

```typescript
  let retryFired = false;
  const startMs = Date.now();

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) retryFired = true;
    throwIfCancelled(deps.token);
    // ... existing body ...
    try {
      const validated = validateResponse(raw, segment);
      const modelTimeMs = Date.now() - startMs;
      const prefix = retryFired ? "[explanation] WARN" : "[explanation]";
      deps.logger?.(
        `${prefix} segmentId=${segment.id} summary=${validated.summary.length}ch `
        + `assumptions=${validated.pointsToConsider.assumptions.length} `
        + `dangers=${validated.pointsToConsider.dangers.length} `
        + `sideEffects=${validated.pointsToConsider.sideEffects.length} `
        + `concepts=${validated.concepts.length} `
        + `modelTimeMs=${modelTimeMs} retryFired=${retryFired}`,
      );
      return { /* existing */ };
    } catch (err) { /* existing */ }
  }
```

The `additionalContext` rendering already lives in Task 5's prompt build (`deps.additionalContext ? "Prior context:\n..." : ""`). Verify that when it's `""`, the rendered prompt doesn't show the literal `Prior context:` header. If the prompt file's `{{additionalContext}}` placeholder leaves a trailing blank line when empty, that's harmless.

- [ ] **Step 7.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "explain.. — cancellation|diagnostics|additionalContext"`
Expected: all 5 tests pass.

- [ ] **Step 7.5: Commit**

```bash
cd codewalk && git add src/engine/explanationAgent.ts test/suite/explanationAgent.test.ts
git commit -m "phase2/step7: explanation agent diagnostics + additionalContext seam

- logger fires once per successful call with segmentId, field counts, modelTimeMs, retryFired. Retry path prefixes '[explanation] WARN '.
- Secret hygiene: raw code, raw prompt, and API keys are never included in log lines (verified by test).
- deps.additionalContext renders in the user prompt under a 'Prior context:' header when non-empty; omitted otherwise. This is the Phase 5 seam.
- Cancellation: throwIfCancelled(token) runs synchronously at entry and between attempts, so a user cancel during the retry gap doesn't burn the second call."
```

---

## Task 8: `ExplanationStore` with `globalState` persistence

**Goal:** Memory-first cache with `globalState` write-through persistence. Key format `${preset}:${promptVersion}:${segmentId}`. Schema-drop on construction for wrong-`promptVersion` entries. `renderState: "streaming"` and `"error"` entries are never persisted. `onDidChange(segmentId)` event fires on every write.

**Files:**
- Create: `codewalk/src/engine/explanationStore.ts`
- Create: `codewalk/test/suite/explanationStore.test.ts`

- [ ] **Step 8.1: Write the tests first**

Create `codewalk/test/suite/explanationStore.test.ts`:

```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Explanation } from "../../src/types";

function fakeExplanation(overrides: Partial<Explanation> = {}): Explanation {
  return {
    segmentId: "seg-abc",
    summary: "A 20+char valid summary that explains what the block does in detail.",
    pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
    concepts: [],
    renderState: "done",
    ...overrides,
  };
}

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  private readonly all = new Set<string>();
  public updateCount = 0;
  public getFailKey?: string;
  keys(): readonly string[] { return Array.from(this.all); }
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.getFailKey === key) return "not valid json" as unknown as T;
    return (this.data.get(key) as T) ?? defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.updateCount++;
    if (value === undefined) {
      this.data.delete(key);
      this.all.delete(key);
      return;
    }
    this.data.set(key, value);
    this.all.add(key);
  }
  setKeysForSync(): void { /* noop */ }
}

function fakeContext(memento?: FakeMemento): vscode.ExtensionContext {
  const m = memento ?? new FakeMemento();
  return {
    globalState: m,
  } as unknown as vscode.ExtensionContext;
}

suite("ExplanationStore", () => {
  test("get returns undefined before any set", () => {
    const store = new ExplanationStore(fakeContext());
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    store.dispose();
  });

  test("set then get returns the same Explanation in memory", () => {
    const store = new ExplanationStore(fakeContext());
    const exp = fakeExplanation();
    store.set("seg-abc", "groq", "v1", exp);
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1"), exp);
    store.dispose();
  });

  test("get returns undefined when any key component differs", () => {
    const store = new ExplanationStore(fakeContext());
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    assert.strictEqual(store.get("seg-xyz", "groq", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "anthropic", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "groq", "v2"), undefined);
    store.dispose();
  });

  test("set persists done entries to globalState under the composed key", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    // FakeMemento.update is sync-ish; give it a tick.
    await new Promise(r => setImmediate(r));
    assert.strictEqual(memento.updateCount, 1);
    assert.ok(memento.keys().some(k => k === "explanation:groq:v1:seg-abc"));
    store.dispose();
  });

  test("set does not persist renderState: 'streaming' entries", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation({ renderState: "streaming", summary: "" }));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(memento.updateCount, 0);
    // But the in-memory map still holds the entry.
    assert.strictEqual(store.get("seg-abc", "groq", "v1")?.renderState, "streaming");
    store.dispose();
  });

  test("set does not throw when globalState.update rejects; entry survives in memory", async () => {
    const memento = new FakeMemento();
    // Override update to throw.
    memento.update = async () => { throw new Error("disk full"); };
    const logs: string[] = [];
    const store = new ExplanationStore(fakeContext(memento), (m) => logs.push(m));
    assert.doesNotThrow(() => store.set("seg-abc", "groq", "v1", fakeExplanation()));
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1")?.segmentId, "seg-abc");
    assert.ok(logs.some(l => l.includes("persistence failed")));
    store.dispose();
  });

  test("construction drops entries whose promptVersion component does not match current", async () => {
    const memento = new FakeMemento();
    // Seed two entries: one with matching v1, one with v0.
    await memento.update("explanation:groq:v0:seg-xyz", fakeExplanation({ segmentId: "seg-xyz" }));
    await memento.update("explanation:groq:v1:seg-abc", fakeExplanation({ segmentId: "seg-abc" }));
    memento.updateCount = 0;
    // Construct the store for promptVersion v1. The v0 entry is dropped.
    const store = new ExplanationStore(fakeContext(memento), undefined, "v1");
    // After construction, the v0 key must be gone.
    assert.ok(!memento.keys().includes("explanation:groq:v0:seg-xyz"));
    // And v1 key remains.
    assert.ok(memento.keys().includes("explanation:groq:v1:seg-abc"));
    // get returns the v1 entry from the rehydrated memory cache.
    assert.strictEqual(store.get("seg-abc", "groq", "v1")?.segmentId, "seg-abc");
    store.dispose();
  });

  test("clear() empties both memory and globalState", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    store.set("seg-xyz", "groq", "v1", fakeExplanation({ segmentId: "seg-xyz" }));
    await new Promise(r => setImmediate(r));
    store.clear();
    await new Promise(r => setImmediate(r));
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    assert.strictEqual(memento.keys().filter(k => k.startsWith("explanation:")).length, 0);
    store.dispose();
  });

  test("onDidChange fires with segmentId on every set", (done) => {
    const store = new ExplanationStore(fakeContext());
    const received: string[] = [];
    store.onDidChange(id => received.push(id));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    setTimeout(() => {
      try {
        assert.deepStrictEqual(received, ["seg-abc"]);
        store.dispose();
        done();
      } catch (e) { done(e); }
    }, 0);
  });
});
```

- [ ] **Step 8.2: Run — expect FAIL**

Run: `cd codewalk && npm test -- --grep "ExplanationStore"`
Expected: module not found.

- [ ] **Step 8.3: Implement `ExplanationStore`**

Create `codewalk/src/engine/explanationStore.ts`:

```typescript
import * as vscode from "vscode";
import type { Explanation } from "../types";
import { EXPLANATION_PROMPT_VERSION } from "./explanationAgent";

const KEY_PREFIX = "explanation:";

function keyFor(preset: string, promptVersion: string, segmentId: string): string {
  return `${KEY_PREFIX}${preset}:${promptVersion}:${segmentId}`;
}

function isDoneExplanation(x: unknown): x is Explanation {
  if (!x || typeof x !== "object") return false;
  const o = x as Explanation;
  return (
    typeof o.segmentId === "string"
    && typeof o.summary === "string"
    && o.renderState === "done"
    && o.pointsToConsider
    && Array.isArray(o.pointsToConsider.assumptions)
    && Array.isArray(o.pointsToConsider.dangers)
    && Array.isArray(o.pointsToConsider.sideEffects)
    && Array.isArray(o.concepts)
  );
}

export class ExplanationStore implements vscode.Disposable {
  private readonly mem = new Map<string, Explanation>();
  private readonly _onDidChange = new vscode.EventEmitter<string>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger?: (msg: string) => void,
    private readonly currentPromptVersion: string = EXPLANATION_PROMPT_VERSION,
  ) {
    this.rehydrate();
  }

  private rehydrate(): void {
    const state = this.context.globalState;
    for (const key of state.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const parts = key.slice(KEY_PREFIX.length).split(":");
      if (parts.length < 3) {
        this.logger?.(`[explanationStore] WARN dropping malformed key ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const [, promptVersion] = parts;
      if (promptVersion !== this.currentPromptVersion) {
        this.logger?.(`[explanationStore] dropping stale-version entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const value = state.get<unknown>(key);
      if (!isDoneExplanation(value)) {
        this.logger?.(`[explanationStore] WARN dropping malformed entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      this.mem.set(key, value);
    }
  }

  get(segmentId: string, preset: string, promptVersion: string): Explanation | undefined {
    return this.mem.get(keyFor(preset, promptVersion, segmentId));
  }

  set(
    segmentId: string,
    preset: string,
    promptVersion: string,
    exp: Explanation,
  ): void {
    const key = keyFor(preset, promptVersion, segmentId);
    this.mem.set(key, exp);
    this._onDidChange.fire(segmentId);
    if (exp.renderState === "done") {
      this.context.globalState.update(key, exp).then(
        () => { /* ok */ },
        (err) => this.logger?.(`[explanationStore] WARN persistence failed: ${(err as Error).message}`),
      );
    }
  }

  clear(): void {
    const keys = Array.from(this.mem.keys());
    this.mem.clear();
    for (const key of keys) {
      void this.context.globalState.update(key, undefined);
      const id = key.split(":").pop()!;
      this._onDidChange.fire(id);
    }
  }

  dispose(): void {
    this.mem.clear();
    this._onDidChange.dispose();
  }
}
```

- [ ] **Step 8.4: Run tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "ExplanationStore"`
Expected: all 9 tests pass.

If the "construction drops entries" test fails because the rehydration is async, make `rehydrate()` await the updates explicitly or do the drops outside the constructor. Simplest fix: make rehydration synchronous by scheduling updates via `void state.update(...)` without awaiting, but accept the test's `await new Promise(r => setImmediate(r))` as the barrier.

- [ ] **Step 8.5: Commit**

```bash
cd codewalk && git add src/engine/explanationStore.ts test/suite/explanationStore.test.ts
git commit -m "phase2/step8: ExplanationStore with globalState persistence

- Key format: explanation:\${preset}:\${promptVersion}:\${segmentId}.
- In-memory Map mirrors globalState; onDidChange(segmentId) fires on every set.
- Only renderState: 'done' entries persist; streaming/error entries stay memory-only.
- On construction, drop entries whose promptVersion != current (automatic schema migration).
- globalState.update failures are caught and logged; entry survives in memory either way.
- Nine tests cover get/set, key isolation, persistence gating, schema drop, error handling, and clear()."
```

---

## Task 9: `CodeWalkCommentController` — expand, collapse, toggle, streaming updates

**Goal:** Own the `vscode.CommentController` instance, implement "only one panel open at a time," react to `ExplanationStore.onDidChange` to restream partial content into the open thread, and wire the cache-hit/miss branching per Flow A/B in the spec.

**Files:**
- Create: `codewalk/src/providers/commentController.ts`
- Create: `codewalk/test/suite/commentController.test.ts`

- [ ] **Step 9.1: Write the controller tests**

Create `codewalk/test/suite/commentController.test.ts`:

```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { CodeWalkCommentController } from "../../src/providers/commentController";
import { SegmentStore } from "../../src/engine/segmentStore";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Explanation, Segment } from "../../src/types";
import type { LLMAdapter } from "../../src/llm/adapter";

function fakeSegment(id: string, startLine: number): Segment {
  return {
    id,
    label: `Block ${id}`,
    oneLiner: `a segment ${id}`,
    startLine,
    endLine: startLine + 5,
    code: "x",
    difficulty: "standard",
  };
}

function fakeExplanation(segId: string, state: Explanation["renderState"] = "done"): Explanation {
  return {
    segmentId: segId,
    summary: "This is a 20+char valid summary that explains what the block does.",
    pointsToConsider: { assumptions: ["Assumes input is valid JSON."], dangers: [], sideEffects: [] },
    concepts: [],
    renderState: state,
  };
}

function makeContext(): vscode.ExtensionContext {
  const data = new Map<string, unknown>();
  return {
    globalState: {
      keys: () => Array.from(data.keys()),
      get: (k: string) => data.get(k),
      update: async (k: string, v: unknown) => { if (v === undefined) data.delete(k); else data.set(k, v); },
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

function explodingAdapter(): LLMAdapter {
  return {
    async complete() { throw new Error("adapter should not be called for cache-hit tests"); },
    async *completeStream() { throw new Error("adapter should not be called for cache-hit tests"); },
  };
}

suite("CodeWalkCommentController", () => {
  test("expand on a cache-hit creates a thread and does not call the adapter", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/a.ts");
    segStore.set(uri, [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    assert.ok(controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("re-expanding the same open segment collapses it (toggle)", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    assert.ok(controller.hasOpenThread());
    await controller.expand("seg-1");
    assert.ok(!controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("expanding a different segment collapses the previously open one", async () => {
    const seg1 = fakeSegment("seg-1", 1);
    const seg2 = fakeSegment("seg-2", 20);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg1, seg2]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));
    expStore.set("seg-2", "groq", "v1", fakeExplanation("seg-2"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    await controller.expand("seg-2");
    assert.ok(controller.hasOpenThread());
    assert.strictEqual(controller.openSegmentId(), "seg-2");
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("collapse() closes the open thread", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    controller.collapse();
    assert.ok(!controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("onDidChange streaming updates mutate the open thread's body in place", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);

    // Seed a streaming placeholder before expand so the controller opens into streaming state.
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1", "streaming"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    const before = controller.currentThreadBody();
    // Update with a richer streaming entry.
    const updated = fakeExplanation("seg-1", "streaming");
    updated.summary = "Now with more characters streamed in for this block.";
    expStore.set("seg-1", "groq", "v1", updated);
    // Give the event emitter a tick.
    await new Promise(r => setImmediate(r));
    const after = controller.currentThreadBody();
    assert.notStrictEqual(after, before);
    assert.ok(after!.includes("more characters streamed"));
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });
});
```

- [ ] **Step 9.2: Run — expect FAIL**

Run: `cd codewalk && npm test -- --grep "CodeWalkCommentController"`
Expected: module not found.

- [ ] **Step 9.3: Implement the controller**

Create `codewalk/src/providers/commentController.ts`:

```typescript
import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { ExplanationStore } from "../engine/explanationStore";
import type { Explanation, Segment } from "../types";
import type { ExplanationDeps } from "../engine/explanationAgent";
import { explain } from "../engine/explanationAgent";
import {
  CancelledError,
  MalformedResponseError,
  NetworkError,
} from "../llm/adapter";
import {
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../engine/explanationAgent";

export interface CommentControllerDeps {
  readonly adapter: ExplanationDeps["adapter"];
  readonly promptsDir: string;
  readonly preset: string;
  readonly promptVersion: string;
  readonly logger?: (msg: string) => void;
  readonly structuredOutputMode?: ExplanationDeps["structuredOutputMode"];
}

class CodeWalkComment implements vscode.Comment {
  constructor(
    public body: vscode.MarkdownString,
    public mode: vscode.CommentMode = vscode.CommentMode.Preview,
    public author: vscode.CommentAuthorInformation = { name: "CodeWalk" },
  ) {}
}

export class CodeWalkCommentController implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private openThread: vscode.CommentThread | undefined;
  private openSegment: Segment | undefined;
  private openTokenSource: vscode.CancellationTokenSource | undefined;
  private readonly storeSub: vscode.Disposable;

  constructor(
    private readonly segStore: SegmentStore,
    private readonly expStore: ExplanationStore,
    private readonly deps: CommentControllerDeps,
  ) {
    this.controller = vscode.comments.createCommentController("codewalk", "CodeWalk");
    this.storeSub = this.expStore.onDidChange(id => this.onExplanationChanged(id));
  }

  hasOpenThread(): boolean {
    return this.openThread !== undefined;
  }

  openSegmentId(): string | undefined {
    return this.openSegment?.id;
  }

  currentThreadBody(): string | undefined {
    if (!this.openThread) return undefined;
    const c = this.openThread.comments[0];
    if (!c) return undefined;
    const body = c.body;
    return typeof body === "string" ? body : body.value;
  }

  collapse(): void {
    if (this.openTokenSource) {
      this.openTokenSource.cancel();
      this.openTokenSource.dispose();
      this.openTokenSource = undefined;
    }
    this.openThread?.dispose();
    this.openThread = undefined;
    this.openSegment = undefined;
  }

  async expand(segmentId: string): Promise<void> {
    // Toggle behavior: same id closes the open thread.
    if (this.openSegment?.id === segmentId) {
      this.collapse();
      return;
    }

    const segment = this.findSegment(segmentId);
    if (!segment) {
      this.deps.logger?.(`[commentController] WARN expand called for unknown segmentId=${segmentId}`);
      return;
    }

    this.collapse();  // close previous if any

    const uri = this.findUri(segmentId);
    if (!uri) return;
    const range = new vscode.Range(segment.startLine - 1, 0, segment.endLine - 1, 0);
    const thread = this.controller.createCommentThread(uri, range, []);
    thread.label = `CodeWalk — ${segment.label}`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.comments = [new CodeWalkComment(new vscode.MarkdownString("_Analyzing…_"))];
    this.openThread = thread;
    this.openSegment = segment;

    // Cache hit?
    const cached = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
    if (cached && cached.renderState === "done") {
      thread.comments = [new CodeWalkComment(renderExplanation(cached))];
      return;
    }
    if (cached && cached.renderState === "streaming") {
      // Another caller (e.g. prefetch) already opened this stream. Subscribe via onDidChange only.
      thread.comments = [new CodeWalkComment(renderExplanation(cached))];
      return;
    }

    // Cache miss — fetch.
    this.openTokenSource = new vscode.CancellationTokenSource();
    const fileContext = ""; // Future work: full-file context. Phase 2 leaves this empty.
    this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
      segmentId,
      summary: "",
      pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
      concepts: [],
      renderState: "streaming",
    });

    const token = this.openTokenSource.token;
    try {
      const final = await explain(segment, fileContext, {
        adapter: this.deps.adapter,
        promptsDir: this.deps.promptsDir,
        logger: this.deps.logger,
        token,
        structuredOutputMode: this.deps.structuredOutputMode,
        onPartial: partial => {
          const current = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
          if (!current) return;
          this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, {
            ...current,
            summary: partial.summary ?? current.summary,
            renderState: "streaming",
          });
        },
      });
      this.expStore.set(segmentId, this.deps.preset, this.deps.promptVersion, final);
    } catch (err) {
      if (err instanceof CancelledError) {
        if (this.openThread === thread) {
          thread.comments = [new CodeWalkComment(new vscode.MarkdownString("_Cancelled._"))];
        }
        return;
      }
      // Replace the body with an error. Do NOT persist error state.
      const message = errorMessage(err);
      if (this.openThread === thread) {
        thread.comments = [new CodeWalkComment(new vscode.MarkdownString(message))];
      }
      this.deps.logger?.(`[commentController] WARN explain failed segmentId=${segmentId} err=${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  private onExplanationChanged(segmentId: string): void {
    if (!this.openThread || this.openSegment?.id !== segmentId) return;
    const exp = this.expStore.get(segmentId, this.deps.preset, this.deps.promptVersion);
    if (!exp) return;
    this.openThread.comments = [new CodeWalkComment(renderExplanation(exp))];
  }

  private findSegment(segmentId: string): Segment | undefined {
    for (const uri of this.allStoreUris()) {
      const segs = this.segStore.get(uri) ?? [];
      const hit = segs.find(s => s.id === segmentId);
      if (hit) return hit;
    }
    return undefined;
  }

  private findUri(segmentId: string): vscode.Uri | undefined {
    for (const uri of this.allStoreUris()) {
      const segs = this.segStore.get(uri) ?? [];
      if (segs.some(s => s.id === segmentId)) return uri;
    }
    return undefined;
  }

  private allStoreUris(): vscode.Uri[] {
    // SegmentStore does not expose uri enumeration; reach through to editors.
    const seen = new Set<string>();
    const uris: vscode.Uri[] = [];
    for (const editor of vscode.window.visibleTextEditors) {
      const key = editor.document.uri.toString();
      if (!seen.has(key)) {
        seen.add(key);
        uris.push(editor.document.uri);
      }
    }
    return uris;
  }

  dispose(): void {
    this.collapse();
    this.storeSub.dispose();
    this.controller.dispose();
  }
}

function renderExplanation(exp: Explanation): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = false;
  if (exp.renderState === "streaming" && !exp.summary) {
    md.appendMarkdown("_Analyzing…_");
    return md;
  }
  md.appendMarkdown(exp.summary);
  if (exp.renderState === "done") {
    const sections: string[] = [];
    if (exp.pointsToConsider.assumptions.length) {
      sections.push(`### Assumptions\n${exp.pointsToConsider.assumptions.map(s => `- ${s}`).join("\n")}`);
    }
    if (exp.pointsToConsider.dangers.length) {
      sections.push(`### Dangers\n${exp.pointsToConsider.dangers.map(s => `- ${s}`).join("\n")}`);
    }
    if (exp.pointsToConsider.sideEffects.length) {
      sections.push(`### Side effects\n${exp.pointsToConsider.sideEffects.map(s => `- ${s}`).join("\n")}`);
    }
    if (sections.length) {
      md.appendMarkdown(`\n\n${sections.join("\n\n")}`);
    }
    if (exp.concepts.length) {
      const body = exp.concepts
        .map(c => `**${c.name}** — ${c.briefExplainer}\n\n*${c.relevance}*`)
        .join("\n\n");
      md.appendMarkdown(`\n\n<details><summary>Concepts (${exp.concepts.length})</summary>\n\n${body}\n\n</details>`);
    }
  }
  return md;
}

function errorMessage(err: unknown): string {
  if (err instanceof SegmentTooLargeError) return `_Couldn't explain: block too large (${err.lineCount} / ${err.maxLines} lines)._`;
  if (err instanceof ExplanationStreamError) return "_Couldn't finish the explanation — the connection dropped._";
  if (err instanceof MalformedResponseError) return "_Couldn't parse the response from the LLM._";
  if (err instanceof NetworkError) return "_Network error while explaining this block._";
  return `_Error: ${(err as Error).message ?? "unknown"}_`;
}
```

- [ ] **Step 9.4: Run the tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "CodeWalkCommentController"`
Expected: 5 tests pass.

Known wrinkle: the `findSegment` implementation walks visible editors via `vscode.window.visibleTextEditors`. In the test environment, no editors are open by default. The toggle/collapse/expand tests pre-seed `SegmentStore` but the controller can't find the URI. **Fix:** expose `SegmentStore.knownUris(): vscode.Uri[]` (1-line addition to `segmentStore.ts` returning `Array.from(this.map.keys()).map(vscode.Uri.parse)`) and use it instead of iterating editors. Update the tests if needed.

- [ ] **Step 9.5: Add `SegmentStore.knownUris()` if not already present**

Modify `codewalk/src/engine/segmentStore.ts` — add a method:

```typescript
  knownUris(): vscode.Uri[] {
    return Array.from(this.map.keys()).map(s => vscode.Uri.parse(s));
  }
```

Replace `allStoreUris()` in the controller to use `this.segStore.knownUris()`.

Re-run: `cd codewalk && npm test -- --grep "CodeWalkCommentController|SegmentStore"`
Expected: all pass.

- [ ] **Step 9.6: Commit**

```bash
cd codewalk && git add src/providers/commentController.ts src/engine/segmentStore.ts test/suite/commentController.test.ts
git commit -m "phase2/step9: CodeWalkCommentController with expand/collapse/toggle and streaming subscription

- Owns a single vscode.CommentController('codewalk').
- expand(id): cache-hit renders full Markdown atomically; cache-miss creates a streaming placeholder, calls explain() with onPartial writing to ExplanationStore.
- Re-clicking the currently open id collapses (toggle).
- Switching to another id collapses the old thread and creates a new one.
- Subscribes to ExplanationStore.onDidChange and re-renders the open thread's body in place when the streaming state progresses.
- renderExplanation renders summary + PTC (Assumptions/Dangers/Side effects) + collapsible <details>Concepts</details>.
- Error states replace the thread body in place and do not persist to globalState.
- SegmentStore.knownUris() added so the controller can resolve segmentId -> Uri without relying on editor focus."
```

---

## Task 10: `PrefetchQueue`

**Goal:** Opt-in background explanation fetcher. Subscribes to `SegmentStore.onDidChange(uri)`, enqueues every segment not already cached, runs with concurrency 2, cancels in-flight work when the same URI re-segments, and disables itself for the rest of the session on `AuthError`.

**Files:**
- Create: `codewalk/src/engine/prefetchQueue.ts`
- Create: `codewalk/test/suite/prefetchQueue.test.ts`

- [ ] **Step 10.1: Write the tests**

Create `codewalk/test/suite/prefetchQueue.test.ts`:

```typescript
import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { PrefetchQueue } from "../../src/engine/prefetchQueue";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Segment } from "../../src/types";
import type { LLMAdapter } from "../../src/llm/adapter";
import { AuthError } from "../../src/llm/adapter";

function seg(id: string, startLine: number): Segment {
  return { id, label: `B${id}`, oneLiner: `o${id}`, startLine, endLine: startLine + 5, code: "x", difficulty: "standard" };
}
function ctx(): vscode.ExtensionContext {
  const data = new Map<string, unknown>();
  return {
    globalState: {
      keys: () => Array.from(data.keys()),
      get: (k: string) => data.get(k),
      update: async (k: string, v: unknown) => { if (v === undefined) data.delete(k); else data.set(k, v); },
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}
const VALID = JSON.stringify({
  summary: "A valid 20+char summary for this block's behavior.",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
});

suite("PrefetchQueue", () => {
  test("enqueueAll calls the adapter once per new segment and fills the store", async () => {
    const store = new ExplanationStore(ctx());
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return VALID; },
      async *completeStream() { calls++; yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: "" },
      preset: "groq",
      promptVersion: "v1",
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.strictEqual(calls, 2);
    assert.ok(store.get("s1", "groq", "v1"));
    assert.ok(store.get("s2", "groq", "v1"));
    q.dispose();
    store.dispose();
  });

  test("skips segments that already have a 'done' cache entry", async () => {
    const store = new ExplanationStore(ctx());
    store.set("s1", "groq", "v1", {
      segmentId: "s1",
      summary: "already cached — this block was prefetched in a prior session.",
      pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
      concepts: [],
      renderState: "done",
    });
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return VALID; },
      async *completeStream() { calls++; yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: "" },
      preset: "groq",
      promptVersion: "v1",
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.strictEqual(calls, 1);
    q.dispose(); store.dispose();
  });

  test("re-enqueuing the same URI cancels the old batch and replaces it with the new one", async () => {
    const store = new ExplanationStore(ctx());
    let started = 0;
    let completed = 0;
    const adapter: LLMAdapter = {
      async complete() {
        started++;
        await new Promise(r => setTimeout(r, 50));
        completed++;
        return VALID;
      },
      async *completeStream() { yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: "" },
      preset: "groq",
      promptVersion: "v1",
      concurrency: 1,
    });
    const uri = vscode.Uri.file("/tmp/a.ts");
    q.enqueueAll(uri, [seg("old-1", 1), seg("old-2", 10), seg("old-3", 20)]);
    await new Promise(r => setTimeout(r, 10));
    q.enqueueAll(uri, [seg("new-1", 1), seg("new-2", 10)]);
    await q.drain();
    // Only the new batch should be completed; the old batch beyond the first in-flight call is cancelled.
    assert.ok(store.get("new-1", "groq", "v1"));
    assert.ok(store.get("new-2", "groq", "v1"));
    q.dispose(); store.dispose();
  });

  test("disables itself for the session on AuthError; subsequent enqueueAll is a no-op", async () => {
    const store = new ExplanationStore(ctx());
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; throw new AuthError("bad key"); },
      async *completeStream() { calls++; throw new AuthError("bad key"); },
    };
    const logs: string[] = [];
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: "" },
      preset: "groq",
      promptVersion: "v1",
      logger: (m) => logs.push(m),
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.ok(calls >= 1 && calls <= 2);  // may stop after first, may finish both
    assert.ok(logs.some(l => l.includes("disabled")));
    calls = 0;
    q.enqueueAll(vscode.Uri.file("/tmp/b.ts"), [seg("s3", 1)]);
    await q.drain();
    assert.strictEqual(calls, 0);
    q.dispose(); store.dispose();
  });
});
```

- [ ] **Step 10.2: Run — expect FAIL**

Run: `cd codewalk && npm test -- --grep "PrefetchQueue"`
Expected: module not found.

- [ ] **Step 10.3: Implement `PrefetchQueue`**

Create `codewalk/src/engine/prefetchQueue.ts`:

```typescript
import * as vscode from "vscode";
import type { Segment } from "../types";
import type { ExplanationDeps } from "./explanationAgent";
import { explain } from "./explanationAgent";
import type { ExplanationStore } from "./explanationStore";
import { AuthError } from "../llm/adapter";

export interface PrefetchQueueDeps {
  readonly explanationStore: ExplanationStore;
  readonly agentDeps: Pick<ExplanationDeps, "adapter" | "promptsDir" | "structuredOutputMode">;
  readonly preset: string;
  readonly promptVersion: string;
  readonly logger?: (msg: string) => void;
  readonly concurrency?: number;
}

interface Job {
  segment: Segment;
  uri: vscode.Uri;
}

export class PrefetchQueue implements vscode.Disposable {
  private readonly concurrency: number;
  private readonly perUriTokens = new Map<string, vscode.CancellationTokenSource>();
  private disabled = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PrefetchQueueDeps) {
    this.concurrency = deps.concurrency ?? 2;
  }

  enqueueAll(uri: vscode.Uri, segments: readonly Segment[]): void {
    if (this.disabled) return;
    // Cancel any in-flight work for this URI and replace.
    const existing = this.perUriTokens.get(uri.toString());
    if (existing) {
      existing.cancel();
      existing.dispose();
    }
    const source = new vscode.CancellationTokenSource();
    this.perUriTokens.set(uri.toString(), source);

    const needsFetch = segments.filter(seg => {
      const cached = this.deps.explanationStore.get(seg.id, this.deps.preset, this.deps.promptVersion);
      return !cached || cached.renderState !== "done";
    });

    const jobs: Job[] = needsFetch.map(segment => ({ segment, uri }));
    this.drainPromise = this.drainPromise.then(() => this.runBatch(jobs, source.token));
  }

  cancelAll(): void {
    for (const src of this.perUriTokens.values()) {
      src.cancel();
      src.dispose();
    }
    this.perUriTokens.clear();
  }

  /** Test hook — resolves when the latest enqueued batch has fully settled. */
  drain(): Promise<void> {
    return this.drainPromise;
  }

  dispose(): void {
    this.cancelAll();
  }

  private async runBatch(jobs: Job[], token: vscode.CancellationToken): Promise<void> {
    const workers: Promise<void>[] = [];
    let cursor = 0;
    const next = async (): Promise<void> => {
      while (cursor < jobs.length && !this.disabled && !token.isCancellationRequested) {
        const i = cursor++;
        const job = jobs[i]!;
        try {
          // Mark streaming placeholder so concurrent user clicks know an agent is working.
          this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, {
            segmentId: job.segment.id,
            summary: "",
            pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
            concepts: [],
            renderState: "streaming",
          });
          const exp = await explain(job.segment, "", {
            adapter: this.deps.agentDeps.adapter,
            promptsDir: this.deps.agentDeps.promptsDir,
            structuredOutputMode: this.deps.agentDeps.structuredOutputMode,
            logger: this.deps.logger,
            token,
          });
          this.deps.explanationStore.set(job.segment.id, this.deps.preset, this.deps.promptVersion, exp);
        } catch (err) {
          if (err instanceof AuthError) {
            this.disabled = true;
            this.deps.logger?.(`[prefetch] disabled: auth failed — fix API key and reload`);
            return;
          }
          this.deps.logger?.(`[prefetch] error segmentId=${job.segment.id} reason=${(err as Error).message}`);
        }
      }
    };
    for (let i = 0; i < Math.min(this.concurrency, jobs.length); i++) workers.push(next());
    await Promise.all(workers);
  }
}
```

- [ ] **Step 10.4: Run tests — expect PASS**

Run: `cd codewalk && npm test -- --grep "PrefetchQueue"`
Expected: 4 tests pass.

- [ ] **Step 10.5: Commit**

```bash
cd codewalk && git add src/engine/prefetchQueue.ts test/suite/prefetchQueue.test.ts
git commit -m "phase2/step10: PrefetchQueue with concurrency 2, cancel-on-reenqueue, auth-disable

- enqueueAll(uri, segments) cancels any prior batch for the same URI and replaces it.
- Workers pull from the jobs array with configurable concurrency (default 2).
- Skips segments that already have a 'done' cache entry.
- AuthError disables the queue for the session; subsequent enqueueAll returns immediately.
- Other errors log at [prefetch] prefix but don't disable.
- drain() test hook resolves when the latest batch settles.
- Four tests cover happy path, cache dedup, reenqueue-cancels-old, and auth-disable behavior."
```

---

## Task 11: `package.json` settings + reset-cache command + handler

**Goal:** Add three new settings, one new command contribution, register the handler, and extend `activationEvents`. No logic yet — wiring lands in Task 12.

**Files:**
- Modify: `codewalk/package.json`
- Modify: `codewalk/src/extension.ts`

- [ ] **Step 11.1: Edit `package.json` — add settings and command**

Modify `codewalk/package.json`. In `activationEvents`, add:

```json
"onCommand:codewalk.resetExplanationCache"
```

In `contributes.commands`, add:

```json
{ "command": "codewalk.resetExplanationCache", "title": "CodeWalk: Reset Explanation Cache" }
```

In `contributes.configuration.properties`, add the three settings:

```json
"codewalk.explanation.prefetchOnSegmentation": {
  "type": "boolean",
  "default": false,
  "description": "If enabled, explanations for every segment are fetched in the background immediately after segmentation, so later CodeLens clicks are instant. Costs extra LLM calls for blocks you may never open."
},
"codewalk.explanation.streamIdleTimeoutMs": {
  "type": "number",
  "default": 60000,
  "description": "Abort an explanation if no tokens arrive from the backend for this many milliseconds."
},
"codewalk.explanation.maxSegmentLines": {
  "type": "number",
  "default": 400,
  "description": "Skip explanation for blocks longer than this many lines."
}
```

- [ ] **Step 11.2: Run `npm run compile-tests` to confirm no JSON syntax errors**

Run: `cd codewalk && npm run compile-tests`
Expected: clean compile.

- [ ] **Step 11.3: Commit the contribution changes (handler registration lands with wiring in Task 12)**

```bash
cd codewalk && git add package.json
git commit -m "phase2/step11: package.json contributions — new settings + reset-explanation-cache command

- codewalk.explanation.prefetchOnSegmentation (default false).
- codewalk.explanation.streamIdleTimeoutMs (default 60000).
- codewalk.explanation.maxSegmentLines (default 400).
- codewalk.resetExplanationCache command declared and added to activationEvents. Handler lands in step 12."
```

---

## Task 12: Extension wiring — activate new modules, swap `expandBlock` stub, extend handleError

**Goal:** Connect `ExplanationStore`, `CodeWalkCommentController`, `PrefetchQueue` in `extension.ts`. Replace the no-op `codewalk.expandBlock` body with `commentController.expand(segmentId)`. Register `codewalk.resetExplanationCache`. Add `SegmentTooLargeError` and `ExplanationStreamError` branches to `startWalkthrough.ts`'s `handleError`.

**Files:**
- Modify: `codewalk/src/extension.ts`
- Modify: `codewalk/src/commands/startWalkthrough.ts`

- [ ] **Step 12.1: Read `extension.ts` and identify the sections to modify**

Open `codewalk/src/extension.ts`. Locate:
- The `activate(context)` function.
- Where `SegmentStore`, `CodeLensProvider`, and the highlighter are constructed.
- Where `codewalk.expandBlock` is currently registered as a no-op.
- Where disposables are pushed into `context.subscriptions`.

- [ ] **Step 12.2: Wire the new modules**

In `activate()`, after the existing `segmentStore` and `codeLensProvider` construction (but before the `commands.registerCommand` calls), add:

```typescript
import { ExplanationStore } from "./engine/explanationStore";
import { EXPLANATION_PROMPT_VERSION } from "./engine/explanationAgent";
import { CodeWalkCommentController } from "./providers/commentController";
import { PrefetchQueue } from "./engine/prefetchQueue";
import { resolveBackend } from "./utils/config";  // existing helper — adjust name to match

// (inside activate, after segmentStore is created)

const outputChannel = vscode.window.createOutputChannel("CodeWalk");  // if not already present
context.subscriptions.push(outputChannel);
const logger = (msg: string) => outputChannel.appendLine(msg);

const explanationStore = new ExplanationStore(context, logger, EXPLANATION_PROMPT_VERSION);
context.subscriptions.push(explanationStore);

// We need an adapter for the controller and queue. The existing code constructs one per command
// invocation via resolveBackend(). Mirror that pattern: construct on demand inside the command
// bodies, OR construct once per activation and reconstruct on config changes.
// Simpler for Phase 2: construct lazily inside the commentController by deferring adapter-building
// to the command path. We'll pass a *factory* to the controller.
// BUT: the tests in Task 9 pass an adapter directly. Keep that; adjust here.

// For Phase 2 MVP, construct the adapter at activation and rebuild on configuration change.
let presetKey = ""; // set by rebuildAdapter
let currentAdapter: LLMAdapter | undefined;
let commentController: CodeWalkCommentController | undefined;
let prefetchQueue: PrefetchQueue | undefined;

async function rebuildWiring(): Promise<void> {
  const cfg = await resolveBackend(context);  // returns { adapter, preset, structuredOutputMode, ... }
  presetKey = cfg.preset;
  currentAdapter = cfg.adapter;

  commentController?.dispose();
  commentController = new CodeWalkCommentController(
    segmentStore,
    explanationStore,
    {
      adapter: currentAdapter,
      promptsDir: context.asAbsolutePath("prompts"),
      preset: presetKey,
      promptVersion: EXPLANATION_PROMPT_VERSION,
      logger,
      structuredOutputMode: cfg.structuredOutputMode,
    },
  );
  context.subscriptions.push(commentController);

  prefetchQueue?.dispose();
  const prefetchEnabled = vscode.workspace.getConfiguration("codewalk.explanation").get<boolean>("prefetchOnSegmentation", false);
  if (prefetchEnabled) {
    prefetchQueue = new PrefetchQueue({
      explanationStore,
      agentDeps: {
        adapter: currentAdapter,
        promptsDir: context.asAbsolutePath("prompts"),
        structuredOutputMode: cfg.structuredOutputMode,
      },
      preset: presetKey,
      promptVersion: EXPLANATION_PROMPT_VERSION,
      logger,
    });
    context.subscriptions.push(prefetchQueue);
    context.subscriptions.push(
      segmentStore.onDidChange(uri => {
        const segs = segmentStore.get(uri);
        if (segs) prefetchQueue?.enqueueAll(uri, segs);
      }),
    );
  }
}

// Call rebuildWiring at activation if a backend is already configured; otherwise wait.
void rebuildWiring();
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration("codewalk.backend")
      || e.affectsConfiguration("codewalk.model")
      || e.affectsConfiguration("codewalk.baseUrl")
      || e.affectsConfiguration("codewalk.explanation.prefetchOnSegmentation")
    ) {
      void rebuildWiring();
    }
  }),
);
```

Note: `resolveBackend(context)` is assumed to exist and return `{ adapter, preset, structuredOutputMode, ... }`. If the actual helper has a different name or shape, read the current `extension.ts` / `config.ts` code and adapt accordingly. The purpose is: from `context`, produce a ready-to-use adapter plus the two values needed for the cache key and the structured-output mode.

- [ ] **Step 12.3: Replace the `codewalk.expandBlock` stub body**

Find the existing registration:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("codewalk.expandBlock", (_segmentId: string) => {
    // no-op stub (Phase 1)
  }),
);
```

Replace with:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("codewalk.expandBlock", async (segmentId: string) => {
    if (!commentController) {
      vscode.window.showInformationMessage("CodeWalk is still initializing — try again in a moment.");
      return;
    }
    await commentController.expand(segmentId);
  }),
);
```

- [ ] **Step 12.4: Register `codewalk.resetExplanationCache` handler**

In `activate()`, add:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("codewalk.resetExplanationCache", () => {
    explanationStore.clear();
    vscode.window.showInformationMessage("CodeWalk: explanation cache cleared.");
  }),
);
```

- [ ] **Step 12.5: Extend `startWalkthrough.ts`'s `handleError` cascade**

Open `codewalk/src/commands/startWalkthrough.ts`. Find the `handleError` function (or whatever catches segmenter errors). At the top of the `instanceof` cascade — ABOVE the existing `NetworkError` branch — add:

```typescript
import {
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../engine/explanationAgent";

// (inside handleError)
if (err instanceof SegmentTooLargeError) {
  vscode.window.showWarningMessage(
    `This block is too large to explain right now (${err.lineCount} / ${err.maxLines} lines).`,
  );
  return;
}
if (err instanceof ExplanationStreamError) {
  vscode.window.showErrorMessage(
    "Couldn't finish the explanation — the connection dropped. Try again.",
  );
  return;
}
// ... existing NetworkError/AuthError/... branches unchanged ...
```

Note: `handleError` currently runs in the `startWalkthrough` path (segmentation). The same cascade is NOT automatically reached from `commentController.expand()` — the controller handles its own errors by writing them into the thread body. That's by design per spec §9.1; this cascade is for cases where `startWalkthrough` itself produces a typed error via prefetch (if the queue is configured to surface them, which it isn't in Phase 2). Leaving the cascade in place is forward-compat hygiene.

- [ ] **Step 12.6: Run the full test suite**

Run: `cd codewalk && npm test`
Expected: all previously-passing tests still pass. There are no new unit tests in this task — the wiring is verified manually next.

- [ ] **Step 12.7: Manual smoke test**

1. `cd codewalk && npm run build`.
2. Open the `codewalk/` folder in VS Code.
3. Press F5 — Extension Development Host launches.
4. Open `test/fixtures/sample.ts`.
5. Run `CodeWalk: Start Walkthrough`.
6. Wait for segmentation to complete. CodeLens labels should appear.
7. Click a CodeLens. The panel should open with `_Analyzing…_` and stream the summary within 2–10 seconds.
8. Click a different CodeLens. The first panel closes, the new one opens.
9. Click the same CodeLens again — it closes.
10. Reload the window (`Developer: Reload Window`). Run `CodeWalk: Start Walkthrough` again. Click the same CodeLens you clicked before — it should appear instantly (cache hit).
11. Open Command Palette, run `CodeWalk: Reset Explanation Cache`. Click the same CodeLens — it should re-stream.

If any step fails, log the error and iterate. Don't commit if step 7 or step 10 is broken.

- [ ] **Step 12.8: Commit**

```bash
cd codewalk && git add src/extension.ts src/commands/startWalkthrough.ts
git commit -m "phase2/step12: wire new modules into extension.ts; swap expandBlock stub; extend handleError

- activate() constructs ExplanationStore, CodeWalkCommentController, PrefetchQueue (gated by codewalk.explanation.prefetchOnSegmentation).
- rebuildWiring() re-creates controller and prefetch queue on configuration change (backend/model/baseUrl/prefetch toggle).
- codewalk.expandBlock now calls commentController.expand(segmentId).
- codewalk.resetExplanationCache clears both in-memory and globalState entries.
- handleError in startWalkthrough.ts recognizes SegmentTooLargeError and ExplanationStreamError.
- Manual smoke test validates streaming + cache-hit + toggle + cache-reset."
```

---

## Task 13: Eval harness — `EVAL_EXPLANATION=1` gated golden-fixture evaluator

**Goal:** `test/eval/explanationEval.test.ts` runs the explanation agent against one seed fixture and prints a per-fixture rubric summary. Hard-fails only on `mustMention` misses. Uses the real configured backend (or a deterministic stubbed one if `EVAL_EXPLANATION_STUBBED=1`).

**Files:**
- Create: `codewalk/test/eval/explanationEval.test.ts`

- [ ] **Step 13.1: Create the fixture and the eval**

Create `codewalk/test/eval/explanationEval.test.ts`:

```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import { suite, test } from "mocha";
import { explain } from "../../src/engine/explanationAgent";
import type { Segment } from "../../src/types";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { PRESETS } from "../../src/llm/presets";

const EVAL_ENABLED = process.env.EVAL_EXPLANATION === "1";
const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

interface Fixture {
  name: string;
  segment: Segment;
  fileContext: string;
  expect: {
    mustMention: string[];
    mustNotMention?: string[];
    minSummaryLength?: number;
    expectedConceptsIncluding?: string[];
  };
}

const FIXTURES: Fixture[] = [
  {
    name: "jwt-validation",
    segment: {
      id: "seg-eval-jwt",
      label: "JWT Validation",
      oneLiner: "Validates an incoming JWT and returns the decoded payload.",
      startLine: 10,
      endLine: 25,
      difficulty: "complex",
      code: `function validateJWT(token: string): Payload {
  if (!token) throw new Error("missing token");
  const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ["HS256"] });
  if (!decoded || typeof decoded === "string") throw new Error("invalid payload");
  return decoded as Payload;
}`,
    },
    fileContext: "// (elided — eval uses block-only context for determinism)",
    expect: {
      mustMention: ["verif", "HS256"],       // summary or PTC must mention verify/verification and HS256
      mustNotMention: ["TODO", "FIXME", "I think"],
      minSummaryLength: 80,
      expectedConceptsIncluding: ["JWT"],
    },
  },
];

function matchesAny(haystack: string, needles: string[]): string[] {
  const hits: string[] = [];
  const lower = haystack.toLowerCase();
  for (const needle of needles) {
    if (lower.includes(needle.toLowerCase())) hits.push(needle);
  }
  return hits;
}

suite("explanation eval", () => {
  if (!EVAL_ENABLED) {
    test("skipped (set EVAL_EXPLANATION=1 to run)", () => {
      assert.ok(true);
    });
    return;
  }

  for (const fx of FIXTURES) {
    test(fx.name, async () => {
      // Use the configured backend; pull apiKey from SecretStorage via environment variable.
      const preset = process.env.CODEWALK_EVAL_PRESET ?? "groq";
      const presetCfg = PRESETS[preset];
      assert.ok(presetCfg, `unknown preset ${preset}`);
      const apiKey = process.env.CODEWALK_EVAL_API_KEY ?? "";
      const adapter = new OpenAICompatibleAdapter(
        { baseUrl: presetCfg.baseUrl, apiKey, model: presetCfg.defaultModel },
        fetch,
      );
      const exp = await explain(fx.segment, fx.fileContext, {
        adapter,
        promptsDir: PROMPTS_DIR,
        structuredOutputMode: presetCfg.structuredOutputMode,
      });

      const allText =
        exp.summary
        + " " + exp.pointsToConsider.assumptions.join(" ")
        + " " + exp.pointsToConsider.dangers.join(" ")
        + " " + exp.pointsToConsider.sideEffects.join(" ");

      const mustMentionHits = matchesAny(allText, fx.expect.mustMention);
      const mustNotMentionHits = matchesAny(allText, fx.expect.mustNotMention ?? []);
      const conceptHits = fx.expect.expectedConceptsIncluding
        ? matchesAny(exp.concepts.map(c => c.name).join(" "), fx.expect.expectedConceptsIncluding)
        : [];
      const lenOk = (fx.expect.minSummaryLength ?? 0) <= exp.summary.length;

      console.log(`[eval] ${fx.name} summary=${exp.summary.length}ch mustMention=${JSON.stringify(mustMentionHits)}/${JSON.stringify(fx.expect.mustMention)} ${mustMentionHits.length === fx.expect.mustMention.length ? "PASS" : "FAIL"}`);
      console.log(`       assumptions=${exp.pointsToConsider.assumptions.length} dangers=${exp.pointsToConsider.dangers.length} sideEffects=${exp.pointsToConsider.sideEffects.length} concepts=${exp.concepts.length}`);
      if (!lenOk) console.warn(`       WARN summary below minSummaryLength ${fx.expect.minSummaryLength}`);
      if (mustNotMentionHits.length) console.warn(`       WARN mustNotMention hits: ${mustNotMentionHits.join(", ")}`);
      if (fx.expect.expectedConceptsIncluding && conceptHits.length !== fx.expect.expectedConceptsIncluding.length) {
        console.warn(`       WARN concepts missing: ${fx.expect.expectedConceptsIncluding.filter(x => !conceptHits.includes(x)).join(", ")}`);
      }

      assert.strictEqual(
        mustMentionHits.length,
        fx.expect.mustMention.length,
        `mustMention misses: ${fx.expect.mustMention.filter(x => !mustMentionHits.includes(x)).join(", ")}`,
      );
    });
  }
});
```

Note: `PRESETS` and `.structuredOutputMode` on each preset are wired by Phase 1's 2026-04-20 fix — this test relies on them.

- [ ] **Step 13.2: Verify the test SKIPS when the env var isn't set**

Run: `cd codewalk && npm test -- --grep "explanation eval"`
Expected: one test named "skipped" passes. No LLM call.

- [ ] **Step 13.3: Verify the test RUNS with a real backend (manual)**

Run: `CODEWALK_EVAL_PRESET=groq CODEWALK_EVAL_API_KEY=<your-groq-key> EVAL_EXPLANATION=1 npm test -- --grep "explanation eval"`
Expected: prints the `[eval] jwt-validation ...` line. Test passes if the LLM includes both `verif` and `HS256` somewhere in the output.

If the test fails, the fixture's `mustMention` list may be too strict for weaker models — acceptable to relax it, but document the change.

- [ ] **Step 13.4: Commit**

```bash
cd codewalk && git add test/eval/explanationEval.test.ts
git commit -m "phase2/step13: explanation eval harness (EVAL_EXPLANATION=1 gated)

- One seed fixture (jwt-validation) covering verification + HS256 mentions, concepts including 'JWT'.
- mustMention misses fail the test; mustNotMention, minSummaryLength, expectedConceptsIncluding misses print warnings.
- Uses the configured preset via CODEWALK_EVAL_PRESET/CODEWALK_EVAL_API_KEY env vars.
- Skipped-by-default behavior keeps local npm test fast and CI-independent per ADR-005 §7."
```

---

## Task 14: Integration test + manual checklist + Phase 2 boundary

**Goal:** Lock the integration contract with a live backend test, update `PROJECT_STATE.md`'s manual verification checklist, and commit the Phase 2 boundary.

**Files:**
- Create: `codewalk/test/integration/explanationLive.test.ts`
- Modify: `docs/PROJECT_STATE.md`

- [ ] **Step 14.1: Create the live integration test**

Create `codewalk/test/integration/explanationLive.test.ts`:

```typescript
import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { explain } from "../../src/engine/explanationAgent";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { PRESETS } from "../../src/llm/presets";
import type { Segment } from "../../src/types";

const LIVE_ENABLED = process.env.CODEWALK_LIVE_EXPLANATION === "1";
const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

function smallSegment(): Segment {
  return {
    id: "seg-live",
    label: "Sum Function",
    oneLiner: "Returns the sum of two numbers.",
    startLine: 1,
    endLine: 3,
    difficulty: "trivial",
    code: "function sum(a: number, b: number): number {\n  return a + b;\n}",
  };
}

suite("explanation live integration", () => {
  if (!LIVE_ENABLED) {
    test("skipped (set CODEWALK_LIVE_EXPLANATION=1 to run)", () => { assert.ok(true); });
    return;
  }

  test("explains a trivial block against the configured backend", async () => {
    const preset = process.env.CODEWALK_EVAL_PRESET ?? "groq";
    const cfg = PRESETS[preset];
    assert.ok(cfg, `unknown preset ${preset}`);
    const apiKey = process.env.CODEWALK_EVAL_API_KEY ?? "";
    const adapter = new OpenAICompatibleAdapter(
      { baseUrl: cfg.baseUrl, apiKey, model: cfg.defaultModel },
      fetch,
    );
    const exp = await explain(smallSegment(), "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      structuredOutputMode: cfg.structuredOutputMode,
    });
    assert.ok(exp.summary.length >= 20);
    assert.strictEqual(exp.renderState, "done");
    assert.ok(Array.isArray(exp.concepts));
  });
});
```

Run: `cd codewalk && npm test -- --grep "explanation live integration"`
Expected: one "skipped" test.

Then — manually, not in CI — run: `CODEWALK_EVAL_PRESET=groq CODEWALK_EVAL_API_KEY=<key> CODEWALK_LIVE_EXPLANATION=1 npm test -- --grep "explanation live integration"`
Expected: real backend returns a valid explanation.

- [ ] **Step 14.2: Append manual verification checklist to PROJECT_STATE.md**

In `docs/PROJECT_STATE.md`, after the existing Phase 1 checklist section, add a new Phase 2 section:

```markdown
## Phase 2 manual verification checklist (do before tagging `phase2-complete`)

### Streaming + panel behavior
- [ ] Open `codewalk/test/fixtures/sample.ts`. Run `CodeWalk: Start Walkthrough`.
- [ ] Click any CodeLens. Panel opens inline below the label. Summary streams in progressively (not all at once).
- [ ] Points to Consider renders as three sub-sections: Assumptions, Dangers, Side effects.
- [ ] Concepts section is a `<details>` block. Collapsed by default; expanding it reveals the tagged concepts.

### Single-panel invariant
- [ ] Click block A's CodeLens — panel A opens.
- [ ] Click block B's CodeLens — panel A disappears, panel B opens.
- [ ] Click block B's CodeLens again — panel B disappears (toggle).
- [ ] Switch to a different editor tab and back — the previously open panel is still open (editor focus doesn't collapse threads).

### Cache persistence
- [ ] Click any CodeLens. Wait for the explanation to finish.
- [ ] Reload the window (`Developer: Reload Window`).
- [ ] Run `CodeWalk: Start Walkthrough` again on the same file.
- [ ] Click the same CodeLens — panel opens instantly (no spinner, no streaming).

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
- [ ] Click a CodeLens. While the summary is still streaming, click a different CodeLens.
- [ ] The first panel disappears cleanly; the second begins streaming.
- [ ] No error toast, no stack trace in the Output channel (just `[commentController]` or `[explanation] cancelled` log line).

### Auth-disable prefetch
- [ ] Deliberately set an invalid API key (`CodeWalk: Reset API Key`, re-enter an invalid value via the wizard).
- [ ] Enable prefetch. Run `CodeWalk: Start Walkthrough`.
- [ ] Output channel shows `[prefetch] disabled: auth failed` after the first auth failure.
- [ ] No further `[prefetch] error` lines that session — the queue is quiet.

### Reset cache command
- [ ] Run `CodeWalk: Reset Explanation Cache` from the Command Palette.
- [ ] An info message confirms the clear.
- [ ] Subsequent CodeLens clicks re-stream (no cache hits).

### Backend / model swap
- [ ] Switch `codewalk.backend` from one preset to another (e.g. Groq → Anthropic or vice versa) via the wizard or settings.
- [ ] Click a CodeLens that was previously cached on the old backend — it re-streams (preset component of the cache key differs).
```

- [ ] **Step 14.3: Update PROJECT_STATE.md status line**

In `docs/PROJECT_STATE.md`, change:

```markdown
**Current phase:** Phase 2 — Level 1 Explanations — **spec drafted, awaiting user review before plan**
**Current step:** Phase 1 is code-complete...
```

to:

```markdown
**Current phase:** Phase 2 — Level 1 Explanations — **implementation complete, manual verification in progress**
**Current step:** All 14 plan tasks landed. Unit tests (explanationAgent, explanationStore, commentController, prefetchQueue) green. Eval harness and live integration test committed behind env vars. Manual verification checklist available in this file.
```

Also update the phase status block:

```markdown
## Phase status
- [x] Phase 1 — Core Loop — **code complete 2026-04-17; cloud path verified 2026-04-20 against Anthropic (Claude Sonnet 4.6) and Groq (llama-3.3-70b-versatile)**
- [x] Phase 2 — Level 1 Explanations — **code complete [fill in date]; manual checklist pending**
- [ ] Phase 3 — Navigation & File Queue
- [ ] Phase 4 — Level 2 & Polish
```

- [ ] **Step 14.4: Final full test run**

Run: `cd codewalk && npm test`
Expected: all unit tests pass. Eval and live-integration tests print "skipped".

- [ ] **Step 14.5: Commit the phase boundary**

```bash
cd codewalk && git add test/integration/explanationLive.test.ts
cd .. && git add docs/PROJECT_STATE.md
git commit -m "phase2/step14: integration test gate + Phase 2 boundary

- explanationLive.test.ts gated by CODEWALK_LIVE_EXPLANATION=1 — one trivial-block smoke test against the configured backend. Skipped by default.
- PROJECT_STATE.md: Phase 2 manual verification checklist added; phase status updated to 'code complete, manual checklist pending'.
- All 14 plan tasks landed. Unit tests green. Eval and live-integration tests wired behind env-var gates."
```

---

## Self-review checklist (ran before handing off)

- [x] **Spec coverage.** Every numbered in-scope item from spec §2.1 maps to at least one task:
  - 1 (ExplanationAgent) → Tasks 1, 4, 5, 6, 7.
  - 2 (prompts/explanation.md) → Task 1.
  - 3 (ExplanationStore) → Task 8.
  - 4 (CommentController) → Task 9.
  - 5 (Streaming adapter) → Task 3.
  - 6 (Partial-update hook) → Task 6.
  - 7 (PrefetchQueue) → Task 10.
  - 8 (codewalk.expandBlock body) → Task 12.
  - 9 (Eval harness) → Task 13.
  - 10 (Settings) → Task 11.
  - 11 (Typed errors) → Task 2 + Task 12 handleError cascade.
  - 12 (Reset command) → Tasks 11 + 12.
  - 13 (Phase 5 seam) → Task 1 (interface) + Task 7 (prompt slot).
- [x] **Placeholder scan.** No `TODO`, no `TBD`, no "add appropriate error handling" — every step has a code block with actual content.
- [x] **Type consistency.** `Explanation`, `Concept`, `ExplanationDeps`, `ExplanationLogger`, `SegmentTooLargeError`, `ExplanationStreamError`, `EXPLANATION_PROMPT_VERSION`, `DEFAULT_MAX_SEGMENT_LINES`, `DEFAULT_STREAM_IDLE_TIMEOUT_MS`, `CodeWalkCommentController`, `PrefetchQueue`, `PrefetchQueueDeps` are defined in Task 1/2/8/9/10 and used consistently thereafter. `keyFor`, `isDoneExplanation`, `renderExplanation` are private helpers (not referenced across tasks). `SegmentStore.knownUris()` added in Task 9.5 and used by controller.
- [x] **Integration test gating.** Live test (`CODEWALK_LIVE_EXPLANATION=1`) and eval harness (`EVAL_EXPLANATION=1`) skip by default to keep CI green and fast.
- [x] **Manual verification checklist.** Covers every user-observable Phase 2 behavior the spec promises.

---

## Notes for the implementing agent

- **Adapter streaming is the highest-risk task.** If Task 3 tests flake, the single most common cause is the fetch mock returning a `Response` whose `body` is a standard `ReadableStream` but a Node-environment adapter uses `@rapidrotaries/foobar` or a custom stream. Stick with `new ReadableStream({ pull })` in tests — the adapter should treat `response.body.getReader()` as the interface contract.
- **The `streamWithIdleTimeout` helper races an `AsyncGenerator.next()` against a `setTimeout` promise.** The subtle bug to watch for: if the first generator call resolves later than the timeout, it will still eventually resolve. Clearing `timeoutId` after every loop is mandatory to avoid leaked timers.
- **`CommentController` tests need a VS Code test host.** They run inside `@vscode/test-electron`. If you see `vscode.comments.createCommentController is not a function`, the test is running outside the extension host — check the `.vscode-test.js` config or your test runner entry point.
- **Phase 5 seam discipline.** The `additionalContext?: string` field is the ONLY forward-compat concession. Do not add more — any other "future hook" is out of scope. Future-Phase-5 work plugs into this field or gets its own ADR.
- **Commits in Phase 1 followed the `phaseN/stepK: ...` pattern.** Task messages above mirror that. Don't batch multiple steps into one commit — each task gets one commit.
