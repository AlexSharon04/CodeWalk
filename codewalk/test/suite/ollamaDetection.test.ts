import * as assert from "node:assert";
import { suite, test } from "mocha";
import { isOllamaReachable, type FetchFn } from "../../src/llm/ollamaDetection";

suite("isOllamaReachable", () => {
  test("strips /v1 suffix and targets /api/tags", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = async (url) => {
      capturedUrl = String(url);
      return { ok: true } as Response;
    };
    await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn);
    assert.strictEqual(capturedUrl, "http://localhost:11434/api/tags");
  });

  test("returns true on 2xx", async () => {
    const fetchFn: FetchFn = async () => ({ ok: true } as Response);
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), true);
  });

  test("returns false on non-2xx", async () => {
    const fetchFn: FetchFn = async () => ({ ok: false } as Response);
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), false);
  });

  test("returns false on fetch rejection", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("ECONNREFUSED"); };
    assert.strictEqual(await isOllamaReachable("http://localhost:11434/v1", 1000, fetchFn), false);
  });

  test("handles baseUrl without /v1 suffix", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = async (url) => {
      capturedUrl = String(url);
      return { ok: true } as Response;
    };
    await isOllamaReachable("http://localhost:11434", 1000, fetchFn);
    assert.strictEqual(capturedUrl, "http://localhost:11434/api/tags");
  });
});
