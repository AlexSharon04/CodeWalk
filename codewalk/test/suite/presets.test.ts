import * as assert from "node:assert";
import { suite, test } from "mocha";
import { resolveBackend } from "../../src/llm/presets";

suite("presets.resolveBackend", () => {
  test("ollama-local uses localhost and does not require key", () => {
    const r = resolveBackend({ backend: "ollama-local", apiKey: "", model: "", baseUrl: "" });
    assert.strictEqual(r.baseUrl, "http://localhost:11434/v1");
    assert.strictEqual(r.model, "qwen2.5-coder:7b");
    assert.strictEqual(r.requiresApiKey, false);
  });

  test("groq preset returns correct URL and default model", () => {
    const r = resolveBackend({ backend: "groq", apiKey: "k", model: "", baseUrl: "" });
    assert.strictEqual(r.baseUrl, "https://api.groq.com/openai/v1");
    assert.strictEqual(r.model, "llama-3.3-70b-versatile");
    assert.strictEqual(r.requiresApiKey, true);
  });

  test("user baseUrl overrides preset", () => {
    const r = resolveBackend({ backend: "groq", apiKey: "k", model: "", baseUrl: "https://proxy.example/v1" });
    assert.strictEqual(r.baseUrl, "https://proxy.example/v1");
  });

  test("user model overrides preset default", () => {
    const r = resolveBackend({ backend: "openai", apiKey: "k", model: "gpt-4o", baseUrl: "" });
    assert.strictEqual(r.model, "gpt-4o");
  });

  test("custom requires baseUrl", () => {
    assert.throws(
      () => resolveBackend({ backend: "custom", apiKey: "", model: "", baseUrl: "" }),
      /baseUrl/,
    );
  });

  test("custom works when baseUrl is set", () => {
    const r = resolveBackend({ backend: "custom", apiKey: "k", model: "m", baseUrl: "https://x.example/v1" });
    assert.strictEqual(r.baseUrl, "https://x.example/v1");
    assert.strictEqual(r.model, "m");
  });

  test("all non-custom presets are covered", () => {
    const backends = ["ollama-local", "openrouter", "groq", "openai", "anthropic-oai", "together"] as const;
    for (const b of backends) {
      const r = resolveBackend({ backend: b, apiKey: "k", model: "", baseUrl: "" });
      assert.ok(r.baseUrl.length > 0, `${b} must have baseUrl`);
      assert.ok(r.model.length > 0, `${b} must have default model`);
    }
  });
});
