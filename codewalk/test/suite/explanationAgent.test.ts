import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import { explain, DEFAULT_MAX_SEGMENT_LINES, EXPLANATION_PROMPT_VERSION, SegmentTooLargeError, ExplanationStreamError } from "../../src/engine/explanationAgent";
import { MalformedResponseError } from "../../src/llm/adapter";
import type { LLMAdapter } from "../../src/llm/adapter";
import type { Segment } from "../../src/types";

const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

suite("explanation prompt", () => {
  test("prompt file exists and loads via prompt loader", () => {
    const rendered = loadPrompt("explanation", {
      language: "typescript",
      filename: "test.ts",
      label: "Block",
      startLine: "1",
      endLine: "10",
      blockCode: "const x = 1;",
      fileContext: "const x = 1;",
      additionalContext: "",
    }, PROMPTS_DIR);
    assert.ok(rendered.includes("## Input"));
    assert.ok(rendered.includes("Block"));
    assert.ok(rendered.includes("typescript"));
  });

  test("EXPLANATION_PROMPT_VERSION is a non-empty string", () => {
    assert.strictEqual(typeof EXPLANATION_PROMPT_VERSION, "string");
    assert.ok(EXPLANATION_PROMPT_VERSION.length > 0);
  });
});

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
  summary: "   a test segment   ",  // matches fakeSegment().oneLiner when trim().toLowerCase() is applied; with padding passes 20-char check (length 20 before trim)
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

  test("drops generic PTC items that use smart apostrophes (U+2019)", async () => {
    const seg = fakeSegment();
    const smartQuoteResponse = JSON.stringify({
      summary: "This is a valid-looking summary paragraph that says enough to pass the length check.",
      pointsToConsider: {
        // First item: smart-apostrophe version of "don't forget" — must be dropped.
        // Second item: specific; must survive.
        assumptions: [
          "Don\u2019t forget to validate the inputs before saving.",
          "Assumes that `session.user` is populated before this block executes.",
        ],
        dangers: [],
        sideEffects: [],
      },
      concepts: [],
    });
    const adapter = stubAdapter([smartQuoteResponse]);
    const result = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(result.pointsToConsider.assumptions.length, 1);
    assert.ok(
      result.pointsToConsider.assumptions[0]!.includes("session.user"),
      "the specific assumption item should survive; the smart-quote generic should be dropped",
    );
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
        // First call: messages.length is 1 (after push), second call: messages.length is 2
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
