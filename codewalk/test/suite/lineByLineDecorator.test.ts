import * as assert from "node:assert";
import { suite, test } from "mocha";
import * as vscode from "vscode";
import { LineByLineDecorator } from "../../src/editor/lineByLineDecorator";
import type { LineAnnotation } from "../../src/types";

suite("LineByLineDecorator", () => {
  test("hasUri is false before any apply", () => {
    const d = new LineByLineDecorator();
    assert.strictEqual(d.hasUri(vscode.Uri.file("/tmp/a")), false);
    d.dispose();
  });

  test("apply then hasUri is true; clear flips it back", () => {
    const d = new LineByLineDecorator();
    const uri = vscode.Uri.file("/tmp/a");
    const annotations: LineAnnotation[] = [
      { line: 5, short: "ok", full: "**body**" },
    ];
    d.apply(uri, annotations);
    assert.strictEqual(d.hasUri(uri), true);
    d.clear(uri);
    assert.strictEqual(d.hasUri(uri), false);
    d.dispose();
  });

  test("fullForLine returns the full body for a known line, undefined otherwise", () => {
    const d = new LineByLineDecorator();
    const uri = vscode.Uri.file("/tmp/a");
    d.apply(uri, [
      { line: 5, short: "five", full: "body five" },
      { line: 8, short: "eight", full: "body eight" },
    ]);
    assert.strictEqual(d.fullForLine(uri, 5), "body five");
    assert.strictEqual(d.fullForLine(uri, 8), "body eight");
    assert.strictEqual(d.fullForLine(uri, 6), undefined);
    assert.strictEqual(d.fullForLine(vscode.Uri.file("/tmp/different"), 5), undefined);
    d.dispose();
  });

  test("clearAll wipes every URI", () => {
    const d = new LineByLineDecorator();
    const a = vscode.Uri.file("/tmp/a");
    const b = vscode.Uri.file("/tmp/b");
    d.apply(a, [{ line: 1, short: "one", full: "body" }]);
    d.apply(b, [{ line: 2, short: "two", full: "body" }]);
    assert.strictEqual(d.hasUri(a), true);
    assert.strictEqual(d.hasUri(b), true);
    d.clearAll();
    assert.strictEqual(d.hasUri(a), false);
    assert.strictEqual(d.hasUri(b), false);
    assert.strictEqual(d.fullForLine(a, 1), undefined);
    assert.strictEqual(d.fullForLine(b, 2), undefined);
    d.dispose();
  });

  test("re-apply on the same URI replaces previous annotations", () => {
    const d = new LineByLineDecorator();
    const uri = vscode.Uri.file("/tmp/a");
    d.apply(uri, [{ line: 5, short: "first", full: "first body" }]);
    assert.strictEqual(d.fullForLine(uri, 5), "first body");
    d.apply(uri, [{ line: 7, short: "second", full: "second body" }]);
    assert.strictEqual(d.fullForLine(uri, 5), undefined);
    assert.strictEqual(d.fullForLine(uri, 7), "second body");
    d.dispose();
  });

  test("dispose clears state and is safe to call twice", () => {
    const d = new LineByLineDecorator();
    d.apply(vscode.Uri.file("/tmp/a"), [{ line: 1, short: "x", full: "y" }]);
    d.dispose();
    // Second dispose should not throw.
    d.dispose();
  });
});
