import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import { annotate } from "../../src/engine/lineByLineAgent";
import type { Segment } from "../../src/types";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { PRESETS } from "../../src/llm/presets";

const EVAL_ENABLED = process.env.EVAL_LINEBYLINE === "1";
const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

interface Fixture {
  name: string;
  segment: Segment;
  expect: {
    minLineCoverageRatio: number;  // ≥ this fraction of block lines should be annotated
    maxLineCoverageRatio: number;  // ≤ this fraction (sanity — annotating every line is noise)
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
      endLine: 16,
      difficulty: "complex",
      code: `function validateJWT(token: string): Payload {
  if (!token) throw new Error("missing token");
  const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ["HS256"] });
  if (!decoded || typeof decoded === "string") throw new Error("invalid payload");
  return decoded as Payload;
}`,
    },
    expect: {
      minLineCoverageRatio: 0.30,
      maxLineCoverageRatio: 1.00,
    },
  },
];

suite("line-by-line eval", () => {
  if (!EVAL_ENABLED) {
    test("skipped (set EVAL_LINEBYLINE=1 to run)", () => {
      assert.ok(true);
    });
    return;
  }

  for (const fx of FIXTURES) {
    test(fx.name, async () => {
      const preset = (process.env.CODEWALK_EVAL_PRESET ?? "groq") as keyof typeof PRESETS;
      const presetCfg = PRESETS[preset];
      assert.ok(presetCfg, `unknown preset ${preset}`);
      const apiKey = process.env.CODEWALK_EVAL_API_KEY ?? "";
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: presetCfg.baseUrl,
        apiKey,
        model: presetCfg.defaultModel,
      });
      const result = await annotate(fx.segment, {
        adapter,
        promptsDir: PROMPTS_DIR,
        structuredOutputMode: presetCfg.structuredOutputMode,
      });

      const lineCount = fx.segment.endLine - fx.segment.startLine + 1;
      const coverage = result.annotations.length / lineCount;
      const minOk = coverage >= fx.expect.minLineCoverageRatio;
      const maxOk = coverage <= fx.expect.maxLineCoverageRatio;

      const allShortInBudget = result.annotations.every((a) => a.short.length <= 60);
      const allWithinRange = result.annotations.every(
        (a) => a.line >= fx.segment.startLine && a.line <= fx.segment.endLine,
      );
      const lines = result.annotations.map((a) => a.line);
      const sorted = [...lines].sort((a, b) => a - b);
      const isSorted = lines.every((v, i) => v === sorted[i]);
      const noDupes = new Set(lines).size === lines.length;

      console.log(
        `[eval] ${fx.name} annotations=${result.annotations.length}/${lineCount} `
        + `coverage=${(coverage * 100).toFixed(0)}% `
        + `shortBudget=${allShortInBudget} inRange=${allWithinRange} sorted=${isSorted} noDupes=${noDupes}`,
      );

      if (!minOk) console.warn(`       WARN coverage below ${fx.expect.minLineCoverageRatio}`);
      if (!maxOk) console.warn(`       WARN coverage above ${fx.expect.maxLineCoverageRatio}`);

      assert.strictEqual(allShortInBudget, true, "every short must be ≤ 60 chars");
      assert.strictEqual(allWithinRange, true, "every line must be within the block range");
      assert.strictEqual(isSorted, true, "annotations must be ascending by line");
      assert.strictEqual(noDupes, true, "no duplicate line numbers");
      assert.strictEqual(minOk, true, `minLineCoverageRatio not met (got ${coverage.toFixed(2)})`);
    });
  }
});
