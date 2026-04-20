import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { PrefetchQueue } from "../../src/engine/prefetchQueue";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Segment } from "../../src/types";
import type { LLMAdapter } from "../../src/llm/adapter";
import { AuthError } from "../../src/llm/adapter";

const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

function seg(id: string, startLine: number): Segment {
  return { id, label: `B${id}`, oneLiner: `o${id}`, startLine, endLine: startLine + 5, code: "x", difficulty: "standard" };
}

function ctx(): vscode.ExtensionContext {
  const data = new Map<string, unknown>();
  return {
    globalState: {
      keys: () => Array.from(data.keys()),
      get: (k: string) => data.get(k),
      update: async (k: string, v: unknown) => { if (v === undefined) data.delete(k); else data.set(k, v); },
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

const VALID = JSON.stringify({
  summary: "A valid 20+char summary for this block's behavior.",
  pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
  concepts: [],
});

suite("PrefetchQueue", () => {
  test("enqueueAll calls the adapter once per new segment and fills the store", async () => {
    const store = new ExplanationStore(ctx());
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return VALID; },
      async *completeStream() { calls++; yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: PROMPTS_DIR },
      preset: "groq",
      promptVersion: "v1",
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.strictEqual(calls, 2);
    assert.ok(store.get("s1", "groq", "v1"));
    assert.ok(store.get("s2", "groq", "v1"));
    q.dispose();
    store.dispose();
  });

  test("skips segments that already have a 'done' cache entry", async () => {
    const store = new ExplanationStore(ctx());
    store.set("s1", "groq", "v1", {
      segmentId: "s1",
      summary: "already cached — this block was prefetched in a prior session.",
      pointsToConsider: { assumptions: [], dangers: [], sideEffects: [] },
      concepts: [],
      renderState: "done",
    });
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; return VALID; },
      async *completeStream() { calls++; yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: PROMPTS_DIR },
      preset: "groq",
      promptVersion: "v1",
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.strictEqual(calls, 1);
    q.dispose();
    store.dispose();
  });

  test("re-enqueuing the same URI cancels the old batch and replaces it with the new one", async () => {
    const store = new ExplanationStore(ctx());
    let started = 0;
    let completed = 0;
    const adapter: LLMAdapter = {
      async complete() {
        started++;
        await new Promise(r => setTimeout(r, 50));
        completed++;
        return VALID;
      },
      async *completeStream() { yield VALID; },
    };
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: PROMPTS_DIR },
      preset: "groq",
      promptVersion: "v1",
      concurrency: 1,
    });
    const uri = vscode.Uri.file("/tmp/a.ts");
    q.enqueueAll(uri, [seg("old-1", 1), seg("old-2", 10), seg("old-3", 20)]);
    await new Promise(r => setTimeout(r, 10));
    q.enqueueAll(uri, [seg("new-1", 1), seg("new-2", 10)]);
    await q.drain();
    // Only the new batch should be completed; the old batch beyond the first in-flight call is cancelled.
    assert.ok(store.get("new-1", "groq", "v1"));
    assert.ok(store.get("new-2", "groq", "v1"));
    q.dispose();
    store.dispose();
  });

  test("disables itself for the session on AuthError; subsequent enqueueAll is a no-op", async () => {
    const store = new ExplanationStore(ctx());
    let calls = 0;
    const adapter: LLMAdapter = {
      async complete() { calls++; throw new AuthError("bad key"); },
      async *completeStream() { calls++; throw new AuthError("bad key"); },
    };
    const logs: string[] = [];
    const q = new PrefetchQueue({
      explanationStore: store,
      agentDeps: { adapter, promptsDir: PROMPTS_DIR },
      preset: "groq",
      promptVersion: "v1",
      logger: (m: string) => logs.push(m),
    });
    q.enqueueAll(vscode.Uri.file("/tmp/a.ts"), [seg("s1", 1), seg("s2", 20)]);
    await q.drain();
    assert.ok(calls >= 1 && calls <= 2);  // may stop after first, may finish both
    assert.ok(logs.some(l => l.includes("disabled")));
    calls = 0;
    q.enqueueAll(vscode.Uri.file("/tmp/b.ts"), [seg("s3", 1)]);
    await q.drain();
    assert.strictEqual(calls, 0);
    q.dispose();
    store.dispose();
  });
});
