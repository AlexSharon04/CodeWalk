import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import {
  EXPLANATION_PROMPT_VERSION,
  SegmentTooLargeError,
  ExplanationStreamError,
} from "../../src/engine/explanationAgent";

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
