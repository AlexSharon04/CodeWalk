import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import { explain, DEFAULT_MAX_SEGMENT_LINES, EXPLANATION_PROMPT_VERSION, SegmentTooLargeError, ExplanationStreamError } from "../../src/engine/explanationAgent";
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
