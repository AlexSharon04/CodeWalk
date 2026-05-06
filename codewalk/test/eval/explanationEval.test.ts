import * as assert from "node:assert";
import * as path from "node:path";
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
    mustMention: string[];                  // case-insensitive substrings that must appear in summary
    mustNotMention?: string[];              // case-insensitive — soft warning
    minSummaryLength?: number;              // soft warning
    maxSummaryLength?: number;              // soft warning
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
      mustMention: ["verif", "HS256"],
      mustNotMention: ["TODO", "FIXME", "I think"],
      minSummaryLength: 80,
      maxSummaryLength: 700,
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
      const preset = (process.env.CODEWALK_EVAL_PRESET ?? "groq") as keyof typeof PRESETS;
      const presetCfg = PRESETS[preset];
      assert.ok(presetCfg, `unknown preset ${preset}`);
      const apiKey = process.env.CODEWALK_EVAL_API_KEY ?? "";
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: presetCfg.baseUrl,
        apiKey,
        model: presetCfg.defaultModel,
      });
      const exp = await explain(fx.segment, fx.fileContext, {
        adapter,
        promptsDir: PROMPTS_DIR,
        structuredOutputMode: presetCfg.structuredOutputMode,
      });

      const mustMentionHits = matchesAny(exp.summary, fx.expect.mustMention);
      const mustNotMentionHits = matchesAny(exp.summary, fx.expect.mustNotMention ?? []);
      const minOk = (fx.expect.minSummaryLength ?? 0) <= exp.summary.length;
      const maxOk = (fx.expect.maxSummaryLength ?? Infinity) >= exp.summary.length;

      console.log(
        `[eval] ${fx.name} summaryChars=${exp.summary.length} `
        + `mustMention=${JSON.stringify(mustMentionHits)}/${JSON.stringify(fx.expect.mustMention)} `
        + `${mustMentionHits.length === fx.expect.mustMention.length ? "PASS" : "FAIL"}`,
      );
      if (!minOk) console.warn(`       WARN summary below minSummaryLength ${fx.expect.minSummaryLength}`);
      if (!maxOk) console.warn(`       WARN summary above maxSummaryLength ${fx.expect.maxSummaryLength}`);
      if (mustNotMentionHits.length) console.warn(`       WARN mustNotMention hits: ${mustNotMentionHits.join(", ")}`);

      assert.strictEqual(
        mustMentionHits.length,
        fx.expect.mustMention.length,
        `mustMention misses: ${fx.expect.mustMention.filter(x => !mustMentionHits.includes(x)).join(", ")}`,
      );
    });
  }
});
