import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { CodeWalkCommentController } from "../../src/providers/commentController";
import { SegmentStore } from "../../src/engine/segmentStore";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Explanation, Segment } from "../../src/types";
import type { LLMAdapter } from "../../src/llm/adapter";

function fakeSegment(id: string, startLine: number): Segment {
  return {
    id,
    label: `Block ${id}`,
    oneLiner: `a segment ${id}`,
    startLine,
    endLine: startLine + 5,
    code: "x",
    difficulty: "standard",
  };
}

function fakeExplanation(segId: string, state: Explanation["renderState"] = "done"): Explanation {
  return {
    segmentId: segId,
    kind: "logic",
    purpose: "This is a 20+char valid summary that explains what the block does.",
    flow: [],
    uses: ["Assumes input is valid JSON."],
    produces: [],
    watch: [],
    concepts: [],
    renderState: state,
  };
}

function makeContext(): vscode.ExtensionContext {
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

function explodingAdapter(): LLMAdapter {
  return {
    async complete() { throw new Error("adapter should not be called for cache-hit tests"); },
    async *completeStream() { throw new Error("adapter should not be called for cache-hit tests"); },
  };
}

suite("CodeWalkCommentController", () => {
  test("expand on a cache-hit creates a thread and does not call the adapter", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/a.ts");
    segStore.set(uri, [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    assert.ok(controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("re-expanding the same open segment collapses it (toggle)", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    assert.ok(controller.hasOpenThread());
    await controller.expand("seg-1");
    assert.ok(!controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("expanding a different segment collapses the previously open one", async () => {
    const seg1 = fakeSegment("seg-1", 1);
    const seg2 = fakeSegment("seg-2", 20);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg1, seg2]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));
    expStore.set("seg-2", "groq", "v1", fakeExplanation("seg-2"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    await controller.expand("seg-2");
    assert.ok(controller.hasOpenThread());
    assert.strictEqual(controller.openSegmentId(), "seg-2");
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("collapse() closes the open thread", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    controller.collapse();
    assert.ok(!controller.hasOpenThread());
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });

  test("onDidChange streaming updates mutate the open thread's body in place", async () => {
    const seg = fakeSegment("seg-1", 1);
    const segStore = new SegmentStore();
    segStore.set(vscode.Uri.file("/tmp/a.ts"), [seg]);
    const ctx = makeContext();
    const expStore = new ExplanationStore(ctx);

    // Seed a streaming placeholder before expand so the controller opens into streaming state.
    expStore.set("seg-1", "groq", "v1", fakeExplanation("seg-1", "streaming"));

    const controller = new CodeWalkCommentController(segStore, expStore, {
      adapter: explodingAdapter(),
      promptsDir: "",
      preset: "groq",
      promptVersion: "v1",
    });
    await controller.expand("seg-1");
    const before = controller.currentThreadBody();
    // Update with a richer streaming entry.
    const updated = fakeExplanation("seg-1", "streaming");
    updated.purpose = "Now with more characters streamed in for this block.";
    expStore.set("seg-1", "groq", "v1", updated);
    // Loader ticks at 250ms; the snap-on-partial path in onExplanationChanged should update
    // within one microtask, but wait up to 1s to avoid CI flakes.
    const deadline = Date.now() + 1000;
    let after = controller.currentThreadBody();
    while (Date.now() < deadline && !(after?.includes("more characters streamed"))) {
      await new Promise(r => setTimeout(r, 30));
      after = controller.currentThreadBody();
    }
    assert.notStrictEqual(after, before);
    assert.ok(after!.includes("more characters streamed"), `typewriter did not catch up: got "${after}"`);
    controller.dispose();
    segStore.dispose();
    expStore.dispose();
  });
});
