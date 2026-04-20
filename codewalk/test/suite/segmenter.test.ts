import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, beforeEach } from "mocha";
import * as vscode from "vscode";
import { FileTooLargeError, segment } from "../../src/engine/segmenter";
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
    assert.ok(/^seg-[0-9a-f]{12}$/.test(result[0].id), `unexpected id shape: ${result[0].id}`);
    assert.strictEqual(result[0].label, "Header");
    assert.strictEqual(result[0].difficulty, "trivial");
    assert.ok(/^seg-[0-9a-f]{12}$/.test(result[1].id), `unexpected id shape: ${result[1].id}`);
    assert.notStrictEqual(result[0].id, result[1].id, "ids must be unique");
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

  test("rejects overlapping segments (triggers retry)", async () => {
    const doc = await openDoc("a\nb\nc\nd\n");
    const adapter = new StubAdapter([
      JSON.stringify({
        segments: [
          { label: "A", oneLiner: "x", startLine: 1, endLine: 2, difficulty: "trivial" },
          { label: "B", oneLiner: "y", startLine: 2, endLine: 3, difficulty: "trivial" },
        ],
      }),
      "garbage",
    ]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR }),
      MalformedResponseError,
    );
    assert.strictEqual(adapter.calls.length, 2);
  });

  test("retry prompt includes the specific validation failure reason", async () => {
    const doc = await openDoc("a\nb\n");
    const adapter = new StubAdapter([
      JSON.stringify({
        segments: [{ label: "A", oneLiner: "x", startLine: 1, endLine: 1, difficulty: "extreme" }],
      }),
      JSON.stringify({
        segments: [{ label: "A", oneLiner: "x", startLine: 1, endLine: 1, difficulty: "trivial" }],
      }),
    ]);
    await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    const retrySystemMsg = adapter.calls[1].messages[0].content;
    assert.ok(retrySystemMsg.includes("per-field validation"), `retry missing failure reason: ${retrySystemMsg}`);
  });

  test("sorts segments by startLine before returning", async () => {
    const doc = await openDoc("a\nb\nc\nd\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "Second", oneLiner: "x", startLine: 3, endLine: 4, difficulty: "standard" },
        { label: "First",  oneLiner: "y", startLine: 1, endLine: 2, difficulty: "trivial" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].label, "First");
    assert.strictEqual(result[1].label, "Second");
  });

  test("segment ids are stable across identical re-runs", async () => {
    const docA = await openDoc("alpha\nbeta\ngamma\ndelta\n");
    const docB = await openDoc("alpha\nbeta\ngamma\ndelta\n");
    const payload = JSON.stringify({
      segments: [
        { label: "Top",    oneLiner: "x", startLine: 1, endLine: 2, difficulty: "trivial" },
        { label: "Bottom", oneLiner: "y", startLine: 3, endLine: 4, difficulty: "standard" },
      ],
    });
    const a = await segment(docA, { adapter: new StubAdapter([payload]), promptsDir: FIXTURES_DIR });
    const b = await segment(docB, { adapter: new StubAdapter([payload]), promptsDir: FIXTURES_DIR });
    assert.strictEqual(a[0].id, b[0].id, "same content should produce same id");
    assert.strictEqual(a[1].id, b[1].id, "same content should produce same id");
  });

  test("segment ids change when block content changes", async () => {
    const doc = await openDoc("alpha\nbeta\ngamma\n");
    const payload1 = JSON.stringify({
      segments: [{ label: "Block", oneLiner: "x", startLine: 1, endLine: 2, difficulty: "trivial" }],
    });
    const payload2 = JSON.stringify({
      segments: [{ label: "Block", oneLiner: "x", startLine: 1, endLine: 3, difficulty: "trivial" }],
    });
    const r1 = await segment(doc, { adapter: new StubAdapter([payload1]), promptsDir: FIXTURES_DIR });
    const r2 = await segment(doc, { adapter: new StubAdapter([payload2]), promptsDir: FIXTURES_DIR });
    assert.notStrictEqual(r1[0].id, r2[0].id, "different range should produce different id");
  });

  test("logger receives segment count, coverage, and drop count", async () => {
    const doc = await openDoc("alpha\nbeta\ngamma\ndelta\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "",  oneLiner: "x", startLine: 1, endLine: 1, difficulty: "trivial" },
        { label: "Z", oneLiner: "y", startLine: 2, endLine: 3, difficulty: "standard" },
      ],
    })]);
    const logs: string[] = [];
    await segment(doc, {
      adapter,
      promptsDir: FIXTURES_DIR,
      logger: (m) => logs.push(m),
    });
    const summary = logs.find((l) => l.includes("[segmenter]") && l.includes("coverage"));
    assert.ok(summary, `no summary log line: ${logs.join("\n")}`);
    assert.ok(summary.includes("1 segment"), summary);
    assert.ok(summary.includes("dropped 1"), summary);
  });

  test("clamps endLine to document lineCount", async () => {
    const doc = await openDoc("a\nb\nc\n");
    const adapter = new StubAdapter([JSON.stringify({
      segments: [
        { label: "X", oneLiner: "y", startLine: 1, endLine: 9999, difficulty: "trivial" },
      ],
    })]);
    const result = await segment(doc, { adapter, promptsDir: FIXTURES_DIR });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].endLine <= doc.lineCount, `endLine ${result[0].endLine} > lineCount ${doc.lineCount}`);
    assert.ok(result[0].code.includes("a"));
    assert.ok(result[0].code.includes("c"));
  });

  test("throws FileTooLargeError before calling the adapter", async () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const doc = await openDoc(text);
    const adapter = new StubAdapter([]);
    await assert.rejects(
      () => segment(doc, { adapter, promptsDir: FIXTURES_DIR, maxLines: 5 }),
      FileTooLargeError,
    );
    assert.strictEqual(adapter.calls.length, 0, "adapter should not be invoked for oversized files");
  });
});
