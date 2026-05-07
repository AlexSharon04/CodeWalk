import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { SegmentStore } from "../../src/engine/segmentStore";
import type { Segment } from "../../src/types";

function fakeSegment(startLine = 1): Segment {
  return {
    id: "seg-0",
    label: "Test Block",
    oneLiner: "a test segment",
    startLine,
    endLine: startLine + 5,
    code: "x",
    difficulty: "standard",
  };
}

class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  private readonly all = new Set<string>();
  keys(): readonly string[] { return Array.from(this.all); }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data.get(key) as T) ?? defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
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

suite("SegmentStore", () => {
  test("get returns undefined before any set", () => {
    const s = new SegmentStore();
    assert.strictEqual(s.get(vscode.Uri.file("/tmp/a")), undefined);
    s.dispose();
  });

  test("set then get returns the same segments", () => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/a");
    const segs = [fakeSegment()];
    s.set(uri, segs);
    assert.deepStrictEqual(s.get(uri), segs);
    s.dispose();
  });

  test("set fires onDidChange with the uri", (done) => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/b");
    const sub = s.onDidChange((changedUri) => {
      try {
        assert.strictEqual(changedUri.toString(), uri.toString());
        sub.dispose();
        s.dispose();
        done();
      } catch (e) { done(e); }
    });
    s.set(uri, [fakeSegment()]);
  });

  test("clear removes entry and fires onDidChange", (done) => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/c");
    s.set(uri, [fakeSegment()]);
    const sub = s.onDidChange((changedUri) => {
      try {
        assert.strictEqual(changedUri.toString(), uri.toString());
        assert.strictEqual(s.get(uri), undefined);
        sub.dispose();
        s.dispose();
        done();
      } catch (e) { done(e); }
    });
    s.clear(uri);
  });

  test("clear on missing uri does not fire", () => {
    const s = new SegmentStore();
    let fired = false;
    const sub = s.onDidChange(() => { fired = true; });
    s.clear(vscode.Uri.file("/tmp/never"));
    sub.dispose();
    s.dispose();
    assert.strictEqual(fired, false);
  });

  test("different URIs are independent", () => {
    const s = new SegmentStore();
    const a = vscode.Uri.file("/tmp/a");
    const b = vscode.Uri.file("/tmp/b");
    s.set(a, [fakeSegment(1)]);
    s.set(b, [fakeSegment(100)]);
    assert.strictEqual(s.get(a)?.[0].startLine, 1);
    assert.strictEqual(s.get(b)?.[0].startLine, 100);
    s.dispose();
  });

  test("clearAll wipes every URI and fires onDidChange for each", () => {
    const s = new SegmentStore();
    const a = vscode.Uri.file("/tmp/a");
    const b = vscode.Uri.file("/tmp/b");
    s.set(a, [fakeSegment(1)]);
    s.set(b, [fakeSegment(100)]);
    const fired: string[] = [];
    const sub = s.onDidChange((u) => fired.push(u.toString()));
    s.clearAll();
    sub.dispose();
    assert.strictEqual(s.get(a), undefined);
    assert.strictEqual(s.get(b), undefined);
    assert.strictEqual(fired.length, 2);
    assert.ok(fired.includes(a.toString()));
    assert.ok(fired.includes(b.toString()));
    s.dispose();
  });
});

suite("SegmentStore — persistence", () => {
  test("set persists segments under prefixed key", async () => {
    const memento = new FakeMemento();
    const s = new SegmentStore(memento);
    const uri = vscode.Uri.file("/tmp/persist.ts");
    s.set(uri, [fakeSegment(1)]);
    await new Promise((r) => setImmediate(r));
    assert.ok(memento.keys().some((k) => k === `segments:${uri.toString()}`));
    s.dispose();
  });

  test("clear removes the persisted entry", async () => {
    const memento = new FakeMemento();
    const s = new SegmentStore(memento);
    const uri = vscode.Uri.file("/tmp/clear.ts");
    s.set(uri, [fakeSegment(1)]);
    await new Promise((r) => setImmediate(r));
    s.clear(uri);
    await new Promise((r) => setImmediate(r));
    assert.ok(!memento.keys().some((k) => k === `segments:${uri.toString()}`));
    s.dispose();
  });

  test("clearAll wipes all persisted entries", async () => {
    const memento = new FakeMemento();
    const s = new SegmentStore(memento);
    s.set(vscode.Uri.file("/tmp/a.ts"), [fakeSegment(1)]);
    s.set(vscode.Uri.file("/tmp/b.ts"), [fakeSegment(100)]);
    await new Promise((r) => setImmediate(r));
    s.clearAll();
    await new Promise((r) => setImmediate(r));
    assert.ok(!memento.keys().some((k) => k.startsWith("segments:")));
    s.dispose();
  });

  test("rehydrate restores entries and fires onDidChange for each", () => {
    const memento = new FakeMemento();
    const s1 = new SegmentStore(memento);
    const a = vscode.Uri.file("/tmp/rehydrate-a.ts");
    const b = vscode.Uri.file("/tmp/rehydrate-b.ts");
    s1.set(a, [fakeSegment(1)]);
    s1.set(b, [fakeSegment(50)]);
    s1.dispose();

    // New store instance — simulates a window reload.
    const s2 = new SegmentStore(memento);
    const fired: string[] = [];
    const sub = s2.onDidChange((u) => fired.push(u.toString()));
    s2.rehydrate();
    sub.dispose();

    assert.strictEqual(s2.get(a)?.[0]?.startLine, 1);
    assert.strictEqual(s2.get(b)?.[0]?.startLine, 50);
    assert.strictEqual(fired.length, 2);
    s2.dispose();
  });

  test("rehydrate drops malformed entries without crashing", async () => {
    const memento = new FakeMemento();
    await memento.update("segments:file:///tmp/garbage.ts", "not an array");
    await memento.update("segments:file:///tmp/wrong-shape.ts", [{ id: "x" }]); // missing fields
    const s = new SegmentStore(memento);
    s.rehydrate();
    assert.strictEqual(s.knownUris().length, 0);
    // Garbage keys cleaned up.
    await new Promise((r) => setImmediate(r));
    assert.ok(!memento.keys().some((k) => k.startsWith("segments:")));
    s.dispose();
  });

  test("works without a memento (no-op persistence)", () => {
    const s = new SegmentStore();
    const uri = vscode.Uri.file("/tmp/no-memento.ts");
    s.set(uri, [fakeSegment(1)]);
    s.rehydrate();
    assert.strictEqual(s.get(uri)?.[0]?.startLine, 1);
    s.dispose();
  });
});
