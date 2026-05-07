import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { LineByLineStore } from "../../src/engine/lineByLineStore";
import type { LineByLine } from "../../src/types";

function fakeAnnotated(overrides: Partial<LineByLine> = {}): LineByLine {
  return {
    segmentId: "seg-abc",
    annotations: [
      { line: 5, short: "ok", full: "**body** with markdown" },
      { line: 8, short: "another", full: "another body" },
    ],
    renderState: "done",
    ...overrides,
  };
}

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  private readonly all = new Set<string>();
  public updateCount = 0;
  keys(): readonly string[] { return Array.from(this.all); }
  get<T>(key: string, defaultValue?: T): T | undefined {
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
  return { globalState: m } as unknown as vscode.ExtensionContext;
}

suite("LineByLineStore", () => {
  test("get returns undefined before any set", () => {
    const store = new LineByLineStore(fakeContext());
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    store.dispose();
  });

  test("set then get returns the same value", () => {
    const store = new LineByLineStore(fakeContext());
    const value = fakeAnnotated();
    store.set("seg-abc", "groq", "v1", value);
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1"), value);
    store.dispose();
  });

  test("get returns undefined when any key component differs", () => {
    const store = new LineByLineStore(fakeContext());
    store.set("seg-abc", "groq", "v1", fakeAnnotated());
    assert.strictEqual(store.get("seg-xyz", "groq", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "anthropic", "v1"), undefined);
    assert.strictEqual(store.get("seg-abc", "groq", "v2"), undefined);
    store.dispose();
  });

  test("set persists done entries under the prefixed key", async () => {
    const memento = new FakeMemento();
    const store = new LineByLineStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeAnnotated());
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(memento.updateCount, 1);
    assert.ok(memento.keys().some((k) => k === "lineByLine:groq:v1:seg-abc"));
    store.dispose();
  });

  test("rehydrate evicts entries with stale promptVersion", () => {
    const memento = new FakeMemento();
    void memento.update("lineByLine:groq:v0:seg-abc", fakeAnnotated());
    const store = new LineByLineStore(fakeContext(memento), undefined, "v1");
    assert.strictEqual(store.get("seg-abc", "groq", "v0"), undefined);
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    assert.ok(!memento.keys().some((k) => k === "lineByLine:groq:v0:seg-abc"));
    store.dispose();
  });

  test("rehydrate keeps entries with current promptVersion", () => {
    const memento = new FakeMemento();
    const value = fakeAnnotated();
    void memento.update("lineByLine:groq:v1:seg-abc", value);
    const store = new LineByLineStore(fakeContext(memento), undefined, "v1");
    assert.deepStrictEqual(store.get("seg-abc", "groq", "v1"), value);
    store.dispose();
  });

  test("clear wipes both memory and persisted entries", async () => {
    const memento = new FakeMemento();
    const store = new LineByLineStore(fakeContext(memento));
    store.set("seg-abc", "groq", "v1", fakeAnnotated());
    store.set("seg-xyz", "groq", "v1", fakeAnnotated({ segmentId: "seg-xyz" }));
    await new Promise((r) => setImmediate(r));
    store.clear();
    assert.strictEqual(store.get("seg-abc", "groq", "v1"), undefined);
    assert.strictEqual(store.get("seg-xyz", "groq", "v1"), undefined);
    assert.ok(!memento.keys().some((k) => k.startsWith("lineByLine:")));
    store.dispose();
  });
});
