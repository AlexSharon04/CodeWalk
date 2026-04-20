import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, suiteSetup } from "mocha";
import * as vscode from "vscode";
import { segment } from "../../src/engine/segmenter";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../../src/llm/ollamaDetection";

const PROMPTS_DIR = path.join(__dirname, "../../../prompts");
const FIXTURES_ROOT = path.join(__dirname, "../../../test/fixtures");

const MIN_MEAN_IOU = 0.4;
const MIN_COUNT_RATIO = 0.5;
const MAX_COUNT_RATIO = 2.0;

interface GoldenSegment {
  label: string;
  startLine: number;
  endLine: number;
}

interface GoldenFixture {
  name: string;
  file: string;
  segments: GoldenSegment[];
}

const FIXTURES: GoldenFixture[] = [
  {
    name: "sample.ts",
    file: path.join(FIXTURES_ROOT, "sample.ts"),
    segments: [
      { label: "Header & Import",  startLine: 1,  endLine: 3 },
      { label: "Config Interface", startLine: 5,  endLine: 8 },
      { label: "Load Config",      startLine: 10, endLine: 16 },
      { label: "Start Server",     startLine: 18, endLine: 20 },
      { label: "Script Entry",     startLine: 22, endLine: 23 },
    ],
  },
];

function rangeIoU(
  a: { startLine: number; endLine: number },
  b: { startLine: number; endLine: number },
): number {
  const interStart = Math.max(a.startLine, b.startLine);
  const interEnd = Math.min(a.endLine, b.endLine);
  const inter = Math.max(0, interEnd - interStart + 1);
  const aLen = a.endLine - a.startLine + 1;
  const bLen = b.endLine - b.startLine + 1;
  const union = aLen + bLen - inter;
  return union === 0 ? 0 : inter / union;
}

suite("eval: segmenter quality vs golden fixtures", function () {
  this.timeout(180000);

  suiteSetup(function () {
    if (process.env.EVAL_SEGMENTER !== "1") this.skip();
  });

  test("mean IoU and segment-count ratio stay within thresholds", async function () {
    const reachable = await isOllamaReachable("http://localhost:11434/v1");
    if (!reachable) this.skip();

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: process.env.EVAL_BASE_URL ?? "http://localhost:11434/v1",
      apiKey: process.env.EVAL_API_KEY ?? "",
      model: process.env.EVAL_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
    });

    const summaries: string[] = [];
    let overallIoU = 0;
    let overallCount = 0;
    const failures: string[] = [];

    for (const fx of FIXTURES) {
      const doc = await vscode.workspace.openTextDocument(fx.file);
      const logs: string[] = [];
      const actual = await segment(doc, {
        adapter,
        promptsDir: PROMPTS_DIR,
        logger: (m) => logs.push(m),
      });

      let totalBestIoU = 0;
      for (const golden of fx.segments) {
        let best = 0;
        for (const a of actual) {
          best = Math.max(best, rangeIoU(golden, a));
        }
        totalBestIoU += best;
      }
      const meanIoU = fx.segments.length ? totalBestIoU / fx.segments.length : 0;
      const countRatio = fx.segments.length ? actual.length / fx.segments.length : 0;

      summaries.push(
        `[eval] ${fx.name}: meanIoU=${meanIoU.toFixed(2)} countRatio=${countRatio.toFixed(2)} (${actual.length}/${fx.segments.length}) ` +
          (logs[0] ?? ""),
      );

      if (meanIoU < MIN_MEAN_IOU) failures.push(`${fx.name}: meanIoU ${meanIoU.toFixed(2)} < ${MIN_MEAN_IOU}`);
      if (countRatio < MIN_COUNT_RATIO) failures.push(`${fx.name}: countRatio ${countRatio.toFixed(2)} < ${MIN_COUNT_RATIO}`);
      if (countRatio > MAX_COUNT_RATIO) failures.push(`${fx.name}: countRatio ${countRatio.toFixed(2)} > ${MAX_COUNT_RATIO}`);

      overallIoU += meanIoU;
      overallCount++;
    }

    for (const line of summaries) console.log(line);
    const avg = overallCount === 0 ? 0 : overallIoU / overallCount;
    console.log(`[eval] overall meanIoU=${avg.toFixed(2)} across ${overallCount} fixture(s)`);

    assert.strictEqual(
      failures.length,
      0,
      `eval thresholds violated:\n  - ${failures.join("\n  - ")}`,
    );
  });
});
