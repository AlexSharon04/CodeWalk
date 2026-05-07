import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { SegmentationStatusTracker } from "../../src/services/segmentationStatusTracker";

suite("SegmentationStatusTracker", () => {
  test("isInFlight is false before any begin", () => {
    const t = new SegmentationStatusTracker();
    assert.strictEqual(t.isInFlight(vscode.Uri.file("/tmp/a")), false);
    t.dispose();
  });

  test("begin then isInFlight is true; end clears it", () => {
    const t = new SegmentationStatusTracker();
    const uri = vscode.Uri.file("/tmp/a");
    t.begin(uri);
    assert.strictEqual(t.isInFlight(uri), true);
    t.end(uri);
    assert.strictEqual(t.isInFlight(uri), false);
    t.dispose();
  });

  test("begin and end fire onDidChange", () => {
    const t = new SegmentationStatusTracker();
    const uri = vscode.Uri.file("/tmp/b");
    let fires = 0;
    const sub = t.onDidChange(() => fires++);
    t.begin(uri);
    t.end(uri);
    sub.dispose();
    assert.strictEqual(fires, 2);
    t.dispose();
  });

  test("end on never-started uri does not fire", () => {
    const t = new SegmentationStatusTracker();
    let fires = 0;
    const sub = t.onDidChange(() => fires++);
    t.end(vscode.Uri.file("/tmp/never"));
    sub.dispose();
    assert.strictEqual(fires, 0);
    t.dispose();
  });

  test("multiple URIs are independent", () => {
    const t = new SegmentationStatusTracker();
    const a = vscode.Uri.file("/tmp/a");
    const b = vscode.Uri.file("/tmp/b");
    t.begin(a);
    t.begin(b);
    assert.strictEqual(t.isInFlight(a), true);
    assert.strictEqual(t.isInFlight(b), true);
    t.end(a);
    assert.strictEqual(t.isInFlight(a), false);
    assert.strictEqual(t.isInFlight(b), true);
    t.dispose();
  });
});
