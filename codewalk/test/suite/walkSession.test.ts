import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { WalkSession } from "../../src/services/walkSession";
import { SegmentStore } from "../../src/engine/segmentStore";
import type { Segment } from "../../src/types";

function seg(id: string, startLine: number): Segment {
  return {
    id,
    label: `Block ${id}`,
    oneLiner: `one-liner ${id}`,
    startLine,
    endLine: startLine + 5,
    code: "x",
    difficulty: "standard",
  };
}

suite("WalkSession", () => {
  test("starts inactive and reports state correctly", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    assert.strictEqual(ws.isActive(), false);
    assert.strictEqual(ws.activeFile(), undefined);
    assert.strictEqual(ws.state().activeFileIndex, -1);
    ws.dispose();
    store.dispose();
  });

  test("addFile adds to the queue and activates if first", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    ws.addFile(uri);
    assert.strictEqual(ws.isActive(), true);
    assert.strictEqual(ws.activeFile()?.toString(), uri.toString());
    ws.dispose();
    store.dispose();
  });

  test("addFile is idempotent for the same URI", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    ws.addFile(uri);
    ws.addFile(uri);
    assert.strictEqual(ws.state().fileQueue.length, 1);
    ws.dispose();
    store.dispose();
  });

  test("setActive on a click moves activeBlockIndex when segments are known", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1), seg("s2", 10), seg("s3", 20)]);
    ws.addFile(uri);
    ws.setActive(uri, "s2");
    assert.strictEqual(ws.state().activeBlockIndex, 1);
    ws.dispose();
    store.dispose();
  });

  test("setActive on a URI not in the queue auto-adds it", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1)]);
    ws.setActive(uri, "s1");
    assert.strictEqual(ws.state().fileQueue.length, 1);
    assert.strictEqual(ws.activeFile()?.toString(), uri.toString());
    ws.dispose();
    store.dispose();
  });

  test("peekNext advances within the active file", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1), seg("s2", 10), seg("s3", 20)]);
    ws.addFile(uri);
    ws.setActive(uri, "s1");
    const next = ws.peekNext();
    assert.ok(next);
    assert.strictEqual(next!.segmentId, "s2");
    assert.strictEqual(next!.blockIndex, 1);
    ws.dispose();
    store.dispose();
  });

  test("peekPrev steps backward within the active file", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1), seg("s2", 10), seg("s3", 20)]);
    ws.addFile(uri);
    ws.setActive(uri, "s2");
    const prev = ws.peekPrev();
    assert.ok(prev);
    assert.strictEqual(prev!.segmentId, "s1");
    ws.dispose();
    store.dispose();
  });

  test("peekNext returns undefined at the last block of the only file in queue", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1), seg("s2", 10)]);
    ws.addFile(uri);
    ws.setActive(uri, "s2");
    const next = ws.peekNext();
    assert.strictEqual(next, undefined);
    ws.dispose();
    store.dispose();
  });

  test("peekNext crosses to the first block of the next file when present", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    store.set(a, [seg("a1", 1)]);
    store.set(b, [seg("b1", 1), seg("b2", 10)]);
    ws.setQueue([a, b]);
    ws.setActive(a, "a1");
    const next = ws.peekNext();
    assert.ok(next);
    assert.strictEqual(next!.uri.toString(), b.toString());
    assert.strictEqual(next!.segmentId, "b1");
    assert.strictEqual(next!.fileIndex, 1);
    ws.dispose();
    store.dispose();
  });

  test("peekNext returns a placeholder target when next file is not yet segmented", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    store.set(a, [seg("a1", 1)]);
    // b has no segments yet
    ws.setQueue([a, b]);
    ws.setActive(a, "a1");
    const next = ws.peekNext();
    assert.ok(next);
    assert.strictEqual(next!.uri.toString(), b.toString());
    assert.strictEqual(next!.segmentId, "");           // sentinel
    assert.strictEqual(next!.blockIndex, -1);
    assert.strictEqual(next!.fileIndex, 1);
    ws.dispose();
    store.dispose();
  });

  test("applyTarget moves activeFileIndex and activeBlockIndex to the target", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    store.set(a, [seg("a1", 1)]);
    store.set(b, [seg("b1", 1), seg("b2", 10)]);
    ws.setQueue([a, b]);
    ws.setActive(a, "a1");
    const next = ws.peekNext()!;
    ws.applyTarget(next);
    assert.strictEqual(ws.state().activeFileIndex, 1);
    assert.strictEqual(ws.state().activeBlockIndex, 0);
    ws.dispose();
    store.dispose();
  });

  test("skipFile drops the active file and returns the first block of the next", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    store.set(a, [seg("a1", 1)]);
    store.set(b, [seg("b1", 1)]);
    ws.setQueue([a, b]);
    ws.setActive(a, "a1");
    const target = ws.skipFile();
    assert.ok(target);
    assert.strictEqual(target!.uri.toString(), b.toString());
    assert.strictEqual(target!.segmentId, "b1");
    assert.strictEqual(ws.state().fileQueue.length, 1);
    ws.dispose();
    store.dispose();
  });

  test("skipFile returns a placeholder target when next file is unsegmented", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    store.set(a, [seg("a1", 1)]);
    // b has no segments yet
    ws.setQueue([a, b]);
    ws.setActive(a, "a1");
    const target = ws.skipFile();
    assert.ok(target, "skipFile must not return undefined when queue still has files");
    assert.strictEqual(target!.uri.toString(), b.toString());
    assert.strictEqual(target!.segmentId, "");
    assert.strictEqual(target!.blockIndex, -1);
    assert.strictEqual(ws.state().fileQueue.length, 1);
    ws.dispose();
    store.dispose();
  });

  test("skipFile on the only file ends the session", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    store.set(uri, [seg("s1", 1)]);
    ws.addFile(uri);
    ws.setActive(uri, "s1");
    const target = ws.skipFile();
    assert.strictEqual(target, undefined);
    assert.strictEqual(ws.isActive(), false);
    ws.dispose();
    store.dispose();
  });

  test("end clears state", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const uri = vscode.Uri.file("/tmp/a.ts");
    ws.addFile(uri);
    ws.end();
    assert.strictEqual(ws.isActive(), false);
    assert.strictEqual(ws.state().fileQueue.length, 0);
    ws.dispose();
    store.dispose();
  });

  test("removeFile shrinks the queue and adjusts activeFileIndex", () => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    const a = vscode.Uri.file("/tmp/a.ts");
    const b = vscode.Uri.file("/tmp/b.ts");
    const c = vscode.Uri.file("/tmp/c.ts");
    ws.setQueue([a, b, c]);
    ws.setActive(b, undefined);
    assert.strictEqual(ws.state().activeFileIndex, 1);
    ws.removeFile(a);
    assert.strictEqual(ws.state().activeFileIndex, 0);
    assert.strictEqual(ws.activeFile()?.toString(), b.toString());
    ws.dispose();
    store.dispose();
  });

  test("onDidChange fires on queue/state mutations", (done) => {
    const store = new SegmentStore();
    const ws = new WalkSession(store);
    let count = 0;
    ws.onDidChange(() => count++);
    ws.addFile(vscode.Uri.file("/tmp/a.ts"));
    setTimeout(() => {
      try {
        assert.ok(count >= 1);
        ws.dispose();
        store.dispose();
        done();
      } catch (e) { done(e); }
    }, 0);
  });
});
