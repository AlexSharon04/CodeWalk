import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import {
  annotate,
  DEFAULT_MAX_BLOCK_LINES,
  LINE_BY_LINE_PROMPT_VERSION,
  LineByLineTooLargeError,
} from "../../src/engine/lineByLineAgent";
import { MalformedResponseError } from "../../src/llm/adapter";
import type { LLMAdapter } from "../../src/llm/adapter";
import type { Segment } from "../../src/types";

const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

function fakeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-abc",
    label: "Test Block",
    oneLiner: "a test segment",
    startLine: 10,
    endLine: 15,
    code: "const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\nreturn z;\n",
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
      throw new Error("not implemented");
    },
  };
}

const VALID = JSON.stringify({
  annotations: [
    { line: 10, short: "declares x as the input value", full: "Initial input that drives the loop." },
    { line: 12, short: "sum stored for later return", full: "`z` is the sum returned at the end." },
  ],
});

suite("lineByLine prompt + version", () => {
  test("LINE_BY_LINE_PROMPT_VERSION is v1", () => {
    assert.strictEqual(LINE_BY_LINE_PROMPT_VERSION, "v1");
  });
});

suite("annotate() — input guard", () => {
  test("throws LineByLineTooLargeError when block exceeds maxBlockLines", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 250 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR, maxBlockLines: 200 }),
      LineByLineTooLargeError,
    );
  });

  test("uses DEFAULT_MAX_BLOCK_LINES when omitted", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: DEFAULT_MAX_BLOCK_LINES + 1 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      LineByLineTooLargeError,
    );
  });

  test("does not call adapter when over budget", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 500 });
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return ""; },
      async *completeStream() { calls++; yield ""; },
    };
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR, maxBlockLines: 200 }),
      LineByLineTooLargeError,
    );
    assert.strictEqual(calls, 0);
  });
});

suite("annotate() — happy path", () => {
  test("returns annotations with line numbers within block range", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([VALID]);
    const result = await annotate(seg, { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(result.segmentId, "seg-abc");
    assert.strictEqual(result.renderState, "done");
    assert.strictEqual(result.annotations.length, 2);
    assert.strictEqual(result.annotations[0]!.line, 10);
    assert.strictEqual(result.annotations[1]!.line, 12);
  });
});

suite("annotate() — per-item validation", () => {
  test("rejects line outside block range", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 99, short: "x", full: "y" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects short longer than 60 chars", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 10, short: "x".repeat(80), full: "y" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects empty short", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 10, short: "", full: "y" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects short with preamble", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 10, short: "Sure, this is a thing", full: "ok body" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects empty full body", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 10, short: "ok", full: "" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects non-integer line", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [{ line: 10.5, short: "ok", full: "ok body" }],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });
});

suite("annotate() — cross-item validation", () => {
  test("rejects duplicate line numbers", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [
        { line: 10, short: "first", full: "ok" },
        { line: 10, short: "second", full: "ok" },
      ],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects unsorted annotations", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({
      annotations: [
        { line: 12, short: "second-by-line", full: "ok" },
        { line: 10, short: "first-by-line", full: "ok" },
      ],
    });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects empty annotations array", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({ annotations: [] });
    const adapter = stubAdapter([bad, bad]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });
});

suite("annotate() — single-retry contract", () => {
  test("first response invalid, second valid → returns valid annotations", async () => {
    const seg = fakeSegment();
    const bad = JSON.stringify({ annotations: [{ line: 99, short: "x", full: "y" }] });
    const adapter = stubAdapter([bad, VALID]);
    const result = await annotate(seg, { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(result.annotations.length, 2);
  });

  test("invalid JSON on attempt 0 retries with stricter prompt", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter(["not json at all", VALID]);
    const result = await annotate(seg, { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(result.annotations.length, 2);
  });

  test("invalid on both attempts → MalformedResponseError", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter(["not json", "still not json"]);
    await assert.rejects(
      () => annotate(seg, { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });
});

suite("LineByLineTooLargeError", () => {
  test("exposes segmentId, lineCount, maxLines", () => {
    const err = new LineByLineTooLargeError("seg-abc", 500, 200);
    assert.strictEqual(err.segmentId, "seg-abc");
    assert.strictEqual(err.lineCount, 500);
    assert.strictEqual(err.maxLines, 200);
    assert.strictEqual(err.name, "LineByLineTooLargeError");
  });
});
