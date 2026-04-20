import * as assert from "node:assert";
import { suite, test } from "mocha";

suite("Smoke", () => {
  test("arithmetic works", () => {
    assert.strictEqual(1 + 1, 2);
  });
});
