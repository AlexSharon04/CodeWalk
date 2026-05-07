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
