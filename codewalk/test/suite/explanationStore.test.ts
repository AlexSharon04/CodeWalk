import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { ExplanationStore } from "../../src/engine/explanationStore";
import type { Explanation } from "../../src/types";

function fakeExplanation(overrides: Partial<Explanation> = {}): Explanation {
  return {
    segmentId: "seg-abc",
    kind: "logic",
    purpose: "A 20+char valid summary that explains what the block does in detail.",
    flow: [],
    uses: [],
    produces: [],
    watch: [],
    concepts: [],
    renderState: "done",
    ...overrides,
  };
}

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  private readonly all = new Set<string>();
  public updateCount = 0;
  public getFailKey?: string;
  keys(): readonly string[] { return Array.from(this.all); }
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.getFailKey === key) return "not valid json" as unknown as T;
    return (this.data.get(key) as T) ?? defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.updateCount++;
    if (value === undefined) {
      this.data.delete(key);
      this.all.delete(key);
      return;
    }
    this.data.set(key, value);
    this.all.add(key);
  }
  setKeysForSync(): void { /* noop */ }
}

function fakeContext(memento?: FakeMemento): vscode.ExtensionContext {
  const m = memento ?? new FakeMemento();
  return {
    globalState: m,
  } as unknown as vscode.ExtensionContext;
}

suite("ExplanationStore", () => {
  test("get returns undefined before any set", () => {
    const store = new ExplanationStore(fakeContext());
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    store.dispose();
  });

  test("set then get returns the same Explanation in memory", () => {
    const store = new ExplanationStore(fakeContext());
    const exp = fakeExplanation();
    store.set("seg-abc", "groq", "v1", exp);
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1"), exp);
    store.dispose();
  });

  test("get returns undefined when any key component differs", () => {
    const store = new ExplanationStore(fakeContext());
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    assert.strictEqual(store.get("seg-xyz", "groq", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "anthropic", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "groq", "v2"), undefined);
    store.dispose();
  });

  test("set persists done entries to globalState under the composed key", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    // FakeMemento.update is sync-ish; give it a tick.
    await new Promise(r => setImmediate(r));
    assert.strictEqual(memento.updateCount, 1);
    assert.ok(memento.keys().some(k => k === "explanation:groq:v1:seg-abc"));
    store.dispose();
  });

  test("set does not persist renderState: 'streaming' entries", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation({ renderState: "streaming", purpose: "" }));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(memento.updateCount, 0);
    // But the in-memory map still holds the entry.
    assert.strictEqual(store.get("seg-abc", "groq", "v1")?.renderState, "streaming");
    store.dispose();
  });

  test("set does not throw when globalState.update rejects; entry survives in memory", async () => {
    const memento = new FakeMemento();
    // Override update to throw.
    memento.update = async () => { throw new Error("disk full"); };
    const logs: string[] = [];
    const store = new ExplanationStore(fakeContext(memento), (m) => logs.push(m));
    assert.doesNotThrow(() => store.set("seg-abc", "groq", "v1", fakeExplanation()));
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1")?.segmentId, "seg-abc");
    assert.ok(logs.some(l => l.includes("persistence failed")));
    store.dispose();
  });

  test("construction drops entries whose promptVersion component does not match current", async () => {
    const memento = new FakeMemento();
    // Seed two entries: one with matching v1, one with v0.
    await memento.update("explanation:groq:v0:seg-xyz", fakeExplanation({ segmentId: "seg-xyz" }));
    await memento.update("explanation:groq:v1:seg-abc", fakeExplanation({ segmentId: "seg-abc" }));
    memento.updateCount = 0;
    // Construct the store for promptVersion v1. The v0 entry is dropped.
    const store = new ExplanationStore(fakeContext(memento), undefined, "v1");
    // After construction, the v0 key must be gone.
    assert.ok(!memento.keys().includes("explanation:groq:v0:seg-xyz"));
    // And v1 key remains.
    assert.ok(memento.keys().includes("explanation:groq:v1:seg-abc"));
    // get returns the v1 entry from the rehydrated memory cache.
    assert.strictEqual(store.get("seg-abc", "groq", "v1")?.segmentId, "seg-abc");
    store.dispose();
  });

  test("clear() empties both memory and globalState", async () => {
    const memento = new FakeMemento();
    const store = new ExplanationStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    store.set("seg-xyz", "groq", "v1", fakeExplanation({ segmentId: "seg-xyz" }));
    await new Promise(r => setImmediate(r));
    store.clear();
    await new Promise(r => setImmediate(r));
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    assert.strictEqual(memento.keys().filter(k => k.startsWith("explanation:")).length, 0);
    store.dispose();
  });

  test("onDidChange fires with segmentId on every set", (done) => {
    const store = new ExplanationStore(fakeContext());
    const received: string[] = [];
    store.onDidChange(id => received.push(id));
    store.set("seg-abc", "groq", "v1", fakeExplanation());
    setTimeout(() => {
      try {
        assert.deepStrictEqual(received, ["seg-abc"]);
        store.dispose();
        done();
      } catch (e) { done(e); }
    }, 0);
  });
});
