import * as assert from "node:assert";
import * as path from "node:path";
import { suite, test, beforeEach } from "mocha";
import { loadPrompt, clearPromptCache } from "../../src/prompts/loader";

const FIXTURES = path.join(__dirname, "../../../test/fixtures/prompts");

suite("promptLoader", () => {
  beforeEach(() => clearPromptCache());

  test("substitutes placeholders", () => {
    const out = loadPrompt("hello", { name: "Alex", language: "TypeScript" }, FIXTURES);
    assert.strictEqual(out, "Hello Alex, your favorite language is TypeScript.\n");
  });

  test("throws on unsubstituted placeholder", () => {
    assert.throws(
      () => loadPrompt("hello", { name: "Alex" }, FIXTURES),
      /unsubstituted placeholders.*language/i,
    );
  });

  test("throws when file is missing", () => {
    assert.throws(
      () => loadPrompt("does-not-exist", {}, FIXTURES),
      /not found/i,
    );
  });

  test("caches after first load", () => {
    const a = loadPrompt("hello", { name: "A", language: "TS" }, FIXTURES);
    const b = loadPrompt("hello", { name: "B", language: "TS" }, FIXTURES);
    assert.notStrictEqual(a, b); // different substitutions
    assert.ok(a.includes("Hello A"));
    assert.ok(b.includes("Hello B"));
  });
});
