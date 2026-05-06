import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { suite, test } from "mocha";
import { loadPrompt } from "../../src/prompts/loader";
import {
  explain,
  DEFAULT_MAX_SEGMENT_LINES,
  EXPLANATION_PROMPT_VERSION,
  SegmentTooLargeError,
  ExplanationStreamError,
  synthesizeTrivial,
} from "../../src/engine/explanationAgent";
import { MalformedResponseError, AuthError, RateLimitError, CancelledError } from "../../src/llm/adapter";
import type { LLMAdapter } from "../../src/llm/adapter";
import type { Segment } from "../../src/types";

const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

const VALID_SUMMARY = "Validates the login payload and looks the user up by email, then verifies the bcrypt hash. Watch line 14 — the email is concatenated into the SQL query without escaping.";

const VALID_RESPONSE = JSON.stringify({ summary: VALID_SUMMARY });
const SHORT_SUMMARY_RESPONSE = JSON.stringify({ summary: "Too short." });
const PREAMBLE_RESPONSE = JSON.stringify({ summary: "Sure, this block validates the login payload and looks the user up by email." });
const FENCE_RESPONSE = JSON.stringify({ summary: "```\nValidates the login payload and looks the user up by email.\n```" });
const ONELINER_ECHO_RESPONSE = JSON.stringify({ summary: "   a test segment   " });
const RETRY_SUCCEEDED_RESPONSE = JSON.stringify({ summary: "Retry succeeded with a sufficiently long summary that explains what the block actually does in programmer terms." });
const TOO_LONG_RESPONSE = JSON.stringify({ summary: "x".repeat(800) });

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
      difficulty: "standard",
    }, PROMPTS_DIR);
    assert.ok(rendered.includes("## Input"));
    assert.ok(rendered.includes("Block"));
    assert.ok(rendered.includes("typescript"));
  });

  test("EXPLANATION_PROMPT_VERSION is v3", () => {
    assert.strictEqual(EXPLANATION_PROMPT_VERSION, "v3");
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

  test("name is SegmentTooLargeError", () => {
    const err = new SegmentTooLargeError("seg-abc", 500, 400);
    assert.strictEqual(err.name, "SegmentTooLargeError");
  });
});

suite("ExplanationStreamError", () => {
  test("exposes segmentId, partialBytes, cause", () => {
    const err = new ExplanationStreamError("seg-abc", 1024, "network");
    assert.strictEqual(err.segmentId, "seg-abc");
    assert.strictEqual(err.partialBytes, 1024);
    assert.strictEqual(err.cause, "network");
  });
});

function fakeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-abc",
    label: "Test Block",
    oneLiner: "a test segment",
    startLine: 1,
    endLine: 10,
    code: "const x = 1;",
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
      const resp = responses[i++];
      if (resp === undefined) throw new Error("stubAdapter exhausted");
      yield resp;
    },
  };
}

suite("explain() — input guard", () => {
  test("throws SegmentTooLargeError when segment exceeds maxSegmentLines", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 500 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, maxSegmentLines: 400 }),
      SegmentTooLargeError,
    );
  });

  test("uses DEFAULT_MAX_SEGMENT_LINES when maxSegmentLines is omitted", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: DEFAULT_MAX_SEGMENT_LINES + 1 });
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      SegmentTooLargeError,
    );
  });

  test("does not call adapter when segment is over budget", async () => {
    const seg = fakeSegment({ startLine: 1, endLine: 500 });
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return ""; },
      async *completeStream() { calls++; yield ""; },
    };
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, maxSegmentLines: 400 }),
      SegmentTooLargeError,
    );
    assert.strictEqual(calls, 0);
  });
});

suite("explain() — happy path (non-streaming)", () => {
  test("returns an Explanation with the summary field populated", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([VALID_RESPONSE]);
    const result = await explain(seg, "const x = 1;", {
      adapter,
      promptsDir: PROMPTS_DIR,
    });
    assert.strictEqual(result.segmentId, "seg-abc");
    assert.strictEqual(result.summary, VALID_SUMMARY);
    assert.strictEqual(result.renderState, "done");
  });
});

suite("explain() — per-item validation", () => {
  test("rejects summary shorter than 40 chars (MalformedResponseError after retry)", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([SHORT_SUMMARY_RESPONSE, SHORT_SUMMARY_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects summary longer than 700 chars", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([TOO_LONG_RESPONSE, TOO_LONG_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects summary that begins with a preamble", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([PREAMBLE_RESPONSE, PREAMBLE_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("rejects summary that begins with a Markdown fence", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([FENCE_RESPONSE, FENCE_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      MalformedResponseError,
    );
  });

  test("retries when summary is identical to segment.oneLiner (case/whitespace-insensitive)", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([ONELINER_ECHO_RESPONSE, RETRY_SUCCEEDED_RESPONSE]);
    const result = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.notStrictEqual(result.summary.trim().toLowerCase(), seg.oneLiner.trim().toLowerCase());
  });
});

suite("explain() — retry with threaded reason", () => {
  test("retry prompt includes the specific failure reason from the first attempt", async () => {
    const seg = fakeSegment();
    const messages: Array<Array<{ role: string; content: string }>> = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        messages.push(msgs.map(m => ({ role: m.role, content: m.content })));
        return messages.length === 1 ? ONELINER_ECHO_RESPONSE : RETRY_SUCCEEDED_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(messages.length, 2);
    const retrySystem = messages[1]!.find(m => m.role === "system")!.content;
    assert.ok(retrySystem.includes("CRITICAL"));
    assert.ok(retrySystem.toLowerCase().includes("oneliner"), "retry must name the validation failure");
  });

  test("retries once; second failure surfaces MalformedResponseError with both attempts", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([SHORT_SUMMARY_RESPONSE, SHORT_SUMMARY_RESPONSE]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR }),
      (err: Error) =>
        err instanceof MalformedResponseError
        && typeof (err as MalformedResponseError).rawResponse === "string"
        && (err as MalformedResponseError).rawResponse!.includes("first")
        && (err as MalformedResponseError).rawResponse!.includes("second"),
    );
  });
});

function streamingAdapter(chunks: string[]): LLMAdapter {
  return {
    async complete() { throw new Error("streamingAdapter only implements completeStream"); },
    async *completeStream() { for (const c of chunks) yield c; },
  };
}

suite("explain() — streaming", () => {
  test("onPartial fires with monotonically-growing summary as tokens arrive", async () => {
    const seg = fakeSegment();
    const whole = VALID_RESPONSE;
    const sliceAt = whole.indexOf(", ") + 2;
    const chunks = [whole.slice(0, sliceAt), whole.slice(sliceAt, sliceAt + 40), whole.slice(sliceAt + 40)];
    const adapter = streamingAdapter(chunks);
    const partials: Array<{ summary?: string }> = [];
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      onPartial: p => partials.push({ ...p }),
    });
    const summaries = partials.map(p => p.summary ?? "");
    assert.ok(summaries.some(s => s.length > 0), "expected at least one partial with summary");
    for (let i = 1; i < summaries.length; i++) {
      if (summaries[i]!.length > 0 && summaries[i - 1]!.length > 0) {
        assert.ok(summaries[i]!.startsWith(summaries[i - 1]!), "summary stream should grow monotonically");
      }
    }
  });

  test("throws ExplanationStreamError when underlying stream hits idle timeout", async () => {
    const seg = fakeSegment();
    const adapter: LLMAdapter = {
      async complete() { throw new Error("not used"); },
      async *completeStream() {
        yield `{"summary": "start`;
        await new Promise(() => { /* hang */ });
      },
    };
    await assert.rejects(
      () => explain(seg, "", {
        adapter,
        promptsDir: PROMPTS_DIR,
        onPartial: () => {},
        streamIdleTimeoutMs: 80,
      }),
      (err: Error) => err instanceof ExplanationStreamError && err.cause === "provider-terminated",
    );
  });

  test("propagates AuthError from the adapter without wrapping", async () => {
    const seg = fakeSegment();
    const adapter: LLMAdapter = {
      async complete() { throw new Error("not used"); },
      async *completeStream() { throw new AuthError("API key rejected"); },
    };
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, onPartial: () => {} }),
      (err: Error) => err instanceof AuthError,
    );
  });

  test("propagates RateLimitError from the adapter without wrapping", async () => {
    const seg = fakeSegment();
    const adapter: LLMAdapter = {
      async complete() { throw new Error("not used"); },
      async *completeStream() { throw new RateLimitError("rate limited", 30); },
    };
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, onPartial: () => {} }),
      (err: Error) => err instanceof RateLimitError,
    );
  });
});

suite("explain() — cancellation", () => {
  test("throws CancelledError synchronously if token cancelled before first attempt", async () => {
    const seg = fakeSegment();
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    const adapter = stubAdapter([]);
    await assert.rejects(
      () => explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, token: source.token }),
      CancelledError,
    );
  });
});

suite("explain() — diagnostics", () => {
  test("logger receives a one-line summary line and does not leak raw code", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([VALID_RESPONSE]);
    const lines: string[] = [];
    await explain(seg, "const x = 1;", {
      adapter,
      promptsDir: PROMPTS_DIR,
      logger: (msg) => lines.push(msg),
    });
    const first = lines.find(l => l.includes("[explanation]"));
    assert.ok(first, "logger should receive an [explanation] summary line");
    assert.ok(first!.includes("segmentId=seg-abc"));
    assert.ok(first!.includes("source=llm"));
    assert.ok(first!.includes("summaryChars="));
    for (const line of lines) {
      assert.ok(!line.includes("const x = 1;"), `log line leaked raw code: ${line}`);
    }
  });

  test("logger emits WARN line when retry fires", async () => {
    const seg = fakeSegment();
    const adapter = stubAdapter([ONELINER_ECHO_RESPONSE, RETRY_SUCCEEDED_RESPONSE]);
    const lines: string[] = [];
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      logger: (msg) => lines.push(msg),
    });
    assert.ok(lines.some(l => l.startsWith("[explanation] WARN") && l.includes("retryFired=true")));
  });
});

suite("explain() — additionalContext Phase 5 seam", () => {
  test("renders `Prior context:` block in the user prompt when additionalContext is non-empty", async () => {
    const seg = fakeSegment();
    const capturedUser: string[] = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        capturedUser.push(msgs.find(m => m.role === "user")!.content);
        return VALID_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", {
      adapter,
      promptsDir: PROMPTS_DIR,
      additionalContext: "You've already seen validateJWT.",
    });
    assert.strictEqual(capturedUser.length, 1);
    assert.ok(capturedUser[0]!.includes("Prior context:"));
    assert.ok(capturedUser[0]!.includes("validateJWT"));
  });

  test("omits the `Prior context:` header when additionalContext is undefined", async () => {
    const seg = fakeSegment();
    const capturedUser: string[] = [];
    const adapter: LLMAdapter = {
      async complete(msgs) {
        capturedUser.push(msgs.find(m => m.role === "user")!.content);
        return VALID_RESPONSE;
      },
      async *completeStream() { yield ""; },
    };
    await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(capturedUser.length, 1);
    assert.ok(!capturedUser[0]!.includes("Prior context:"));
  });
});

suite("synthesizeTrivial", () => {
  test("returns summary equal to oneLiner with renderState=done", () => {
    const seg = fakeSegment({ difficulty: "trivial", oneLiner: "Imports for core utilities." });
    const exp = synthesizeTrivial(seg);
    assert.strictEqual(exp.segmentId, seg.id);
    assert.strictEqual(exp.summary, "Imports for core utilities.");
    assert.strictEqual(exp.renderState, "done");
  });
});

suite("explain trivial fast path", () => {
  test("returns synthesized explanation without calling the adapter when difficulty is trivial", async () => {
    let adapterCalled = false;
    const adapter: LLMAdapter = {
      async complete() { adapterCalled = true; return "{}"; },
      async *completeStream() { adapterCalled = true; yield "{}"; },
    };
    const seg = fakeSegment({ difficulty: "trivial", oneLiner: "Trivial one-liner." });
    const exp = await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR });
    assert.strictEqual(adapterCalled, false);
    assert.strictEqual(exp.summary, "Trivial one-liner.");
    assert.strictEqual(exp.renderState, "done");
  });

  test("logs source=synth and modelTimeMs for trivial path", async () => {
    const adapter: LLMAdapter = {
      async complete() { throw new Error("should not be called"); },
      async *completeStream() { throw new Error("should not be called"); },
    };
    const seg = fakeSegment({ difficulty: "trivial", oneLiner: "Trivial." });
    const lines: string[] = [];
    await explain(seg, "", { adapter, promptsDir: PROMPTS_DIR, logger: (m) => lines.push(m) });
    assert.ok(lines.some(l => l.includes("source=synth") && l.includes("summaryChars=")));
  });
});
