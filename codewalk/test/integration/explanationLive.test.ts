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
    const preset = (process.env.CODEWALK_EVAL_PRESET ?? "groq") as keyof typeof PRESETS;
    const cfg = PRESETS[preset];
    assert.ok(cfg, `unknown preset ${preset}`);
    const apiKey = process.env.CODEWALK_EVAL_API_KEY ?? "";
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: cfg.baseUrl,
      apiKey,
      model: cfg.defaultModel,
    });
    const exp = await explain(smallSegment(), "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      structuredOutputMode: cfg.structuredOutputMode,
    });
    assert.ok(exp.purpose.length >= 20);
    assert.strictEqual(exp.renderState, "done");
    assert.ok(Array.isArray(exp.concepts));
  });
});
