import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, suiteSetup } from "mocha";
import * as vscode from "vscode";
import { segment } from "../../src/engine/segmenter";
import { OpenAICompatibleAdapter } from "../../src/llm/openAiCompatibleAdapter";
import { isOllamaReachable } from "../../src/llm/ollamaDetection";

const PROMPTS_DIR = path.join(__dirname, "../../../prompts");

suite("integration: Ollama segmentation", function () {
  this.timeout(120000);

  suiteSetup(function () {
    if (process.env.INTEGRATION_TESTS !== "1") {
      this.skip();
    }
  });

  test("segments a real TypeScript file", async function () {
    const reachable = await isOllamaReachable("http://localhost:11434/v1");
    if (!reachable) this.skip();

    const doc = await vscode.workspace.openTextDocument(
      path.join(__dirname, "../../../test/fixtures/sample.ts"),
    );
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      model: process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
    });
    const segments = await segment(doc, { adapter, promptsDir: PROMPTS_DIR });
    assert.ok(segments.length >= 2, `expected ≥ 2 segments, got ${segments.length}`);
    for (const seg of segments) {
      assert.ok(seg.startLine >= 1, "startLine ≥ 1");
      assert.ok(seg.endLine >= seg.startLine, "endLine ≥ startLine");
      assert.ok(seg.label.length > 0);
      assert.ok(seg.oneLiner.length > 0);
    }
  });
});
