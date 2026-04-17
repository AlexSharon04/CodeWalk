import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, beforeEach } from "mocha";
import * as vscode from "vscode";
import { segment } from "../../src/engine/segmenter";
import { clearPromptCache } from "../../src/prompts/loader";
import type { ChatMessage, CompleteOptions, LLMAdapter } from "../../src/llm/adapter";
import { MalformedResponseError } from "../../src/llm/adapter";

const FIXTURES_DIR = path.join(__dirname, "../../../test/fixtures/prompts");

class StubAdapter implements LLMAdapter {
  public calls: Array<{ messages: ChatMessage[]; options?: CompleteOptions }> = [];
  constructor(private readonly responses: Array<string | Error>) {}
  async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    const next = this.responses.shift();
    if (next === undefined) throw new Error("StubAdapter exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

async function openDoc(text: string, language = "typescript"): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content: text, language });
}

suite("segmenter.segment", () => {
  beforeEach(() => clearPromptCache());

  test("returns validated segments on first-try success", async () => {
    const doc = await openDoc("line1\nline2\nline3\nline4\nline5\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "Header", oneLiner: "first block", startLine: 1, endLine: 3, difficulty: "trivial" },
        { label: "Body",   oneLiner: "second block", startLine: 4, endLine: 5, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, "seg-0");
    assert.strictEqual(result[0].label, "Header");
    assert.strictEqual(result[0].difficulty, "trivial");
    assert.strictEqual(result[1].id, "seg-1");
    assert.ok(result[0].code.length > 0);
  });

  test("retries on malformed JSON and succeeds", async () => {
    const doc = await openDoc("a\nb\nc\n");
    const adapter = new StubAdapter([
      "not json at all",
      JSON.stringify({ segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 2, difficulty: "standard" }] }),
    ]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(adapter.calls.length, 2);
    assert.strictEqual(result.length, 1);
    const retrySystemMsg = adapter.calls[1].messages.find(m => m.role === "system")?.content ?? "";
    assert.ok(retrySystemMsg.includes("CRITICAL"), "retry should include stricter instruction");
  });

  test("throws MalformedResponseError after two failed attempts", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter(["garbage", "still garbage"]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects segments with endLine < startLine", async () => {
    const doc = await openDoc("a\nb\nc\nd\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "Bad",  oneLiner: "inverted", startLine: 3, endLine: 1, difficulty: "standard" },
        { label: "Good", oneLiner: "ok",        startLine: 1, endLine: 2, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, "Good");
  });

  test("rejects segments with invalid difficulty", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 2, difficulty: "extreme" }],
    })]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects segments with empty label", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "",  oneLiner: "y", startLine: 1, endLine: 1, difficulty: "standard" },
        { label: "Z", oneLiner: "w", startLine: 2, endLine: 2, difficulty: "standard" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].label, "Z");
  });

  test("populates code field from document range", async () => {
    const doc = await openDoc("alpha\nbeta\ngamma\ndelta\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 2, endLine: 3, difficulty: "standard" }],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.ok(result[0].code.includes("beta"));
    assert.ok(result[0].code.includes("gamma"));
    assert.ok(!result[0].code.includes("alpha"));
  });

  test("first attempt uses json_object response format", async () => {
    const doc = await openDoc("a\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [{ label: "X", oneLiner: "y", startLine: 1, endLine: 1, difficulty: "standard" }],
    })]);
    await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(adapter.calls[0].options?.responseFormat, "json_object");
  });
});
