import * as assert from "node:assert";
import { suite, test } from "mocha";
import {
  OpenAICompatibleAdapter,
  type FetchFn,
} from "../../src/llm/openAiCompatibleAdapter";
import {
  AuthError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
} from "../../src/llm/adapter";

function mockFetch(response: {
  status?: number;
  ok?: boolean;
  body?: unknown;
  bodyText?: string;
  headers?: Record<string, string>;
  throws?: Error;
}): FetchFn {
  return async () => {
    if (response.throws) throw response.throws;
    const status = response.status ?? 200;
    return {
      status,
      ok: response.ok ?? (status >= 200 && status < 300),
      json: async () => response.body,
      text: async () => response.bodyText ?? JSON.stringify(response.body ?? {}),
      headers: {
        get: (name: string) => response.headers?.[name.toLowerCase()] ?? null,
      },
    } as unknown as Response;
  };
}

const CFG = { baseUrl: "http://x/v1", apiKey: "test-key", model: "m" };

suite("OpenAICompatibleAdapter.complete", () => {
  test("returns content on 200", async () => {
    const fetchFn = mockFetch({
      body: { choices: [{ message: { content: "hello world" } }] },
    });
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    const out = await a.complete([{ role: "user", content: "hi" }]);
    assert.strictEqual(out, "hello world");
  });

  test("sends Authorization header when apiKey is set", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedInit = init;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await a.complete([{ role: "user", content: "hi" }]);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.strictEqual(headers["Authorization"], "Bearer test-key");
    assert.strictEqual(headers["Content-Type"], "application/json");
  });

  test("omits Authorization header when apiKey is empty", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedInit = init;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter({ ...CFG, apiKey: "" }, fetchFn);
    await a.complete([{ role: "user", content: "hi" }]);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.strictEqual(headers["Authorization"], undefined);
  });

  test("includes response_format when requested", async () => {
    let capturedBody: string | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      capturedBody = init?.body as string;
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        text: async () => "",
        headers: { get: () => null },
      } as unknown as Response;
    };
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await a.complete([{ role: "user", content: "hi" }], { responseFormat: "json_object" });
    const parsed = JSON.parse(capturedBody!);
    assert.deepStrictEqual(parsed.response_format, { type: "json_object" });
  });

  test("throws AuthError on 401", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 401, bodyText: "bad key" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      AuthError,
    );
  });

  test("throws AuthError on 403", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 403, bodyText: "forbidden" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      AuthError,
    );
  });

  test("throws RateLimitError on 429 with retry-after", async () => {
    const a = new OpenAICompatibleAdapter(
      CFG,
      mockFetch({ status: 429, headers: { "retry-after": "7" }, bodyText: "slow down" }),
    );
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      (e: unknown) => e instanceof RateLimitError && e.retryAfter === 7,
    );
  });

  test("throws NetworkError on fetch exception", async () => {
    const a = new OpenAICompatibleAdapter(
      CFG,
      mockFetch({ throws: new Error("ECONNREFUSED") }),
    );
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      NetworkError,
    );
  });

  test("throws NetworkError on non-2xx non-auth non-rate status", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ status: 500, bodyText: "server down" }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      NetworkError,
    );
  });

  test("throws MalformedResponseError when choices missing", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockFetch({ body: { error: "oops" } }));
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }]),
      MalformedResponseError,
    );
  });
});
