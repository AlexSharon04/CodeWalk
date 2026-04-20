import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import { EXPLANATION_PROMPT_VERSION } from "../../src/engine/explanationAgent";

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
