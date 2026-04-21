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
  StreamIdleTimeoutError,
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

  test("uses json_object when structuredOutputMode is json_object (default)", async () => {
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
    const a = new OpenAICompatibleAdapter({ ...CFG, structuredOutputMode: "json_object" }, fetchFn);
    await a.complete([{ role: "user", content: "hi" }], { responseFormat: "json_object" });
    const parsed = JSON.parse(capturedBody!);
    assert.deepStrictEqual(parsed.response_format, { type: "json_object" });
  });

  test("uses json_schema with caller-provided schema when structuredOutputMode is json_schema", async () => {
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
    const callerSchema = {
      name: "caller_schema",
      strict: true,
      schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false },
    };
    const a = new OpenAICompatibleAdapter({ ...CFG, structuredOutputMode: "json_schema" }, fetchFn);
    await a.complete(
      [{ role: "user", content: "hi" }],
      { responseFormat: "json_object", jsonSchema: callerSchema },
    );
    const parsed = JSON.parse(capturedBody!);
    assert.strictEqual(parsed.response_format.type, "json_schema");
    assert.deepStrictEqual(parsed.response_format.json_schema, callerSchema);
  });

  test("throws when json_schema mode but no jsonSchema provided by caller", async () => {
    const fetchFn: FetchFn = async () => ({ status: 200, ok: true, json: async () => ({}), text: async () => "", headers: { get: () => null } } as unknown as Response);
    const a = new OpenAICompatibleAdapter({ ...CFG, structuredOutputMode: "json_schema" }, fetchFn);
    await assert.rejects(
      () => a.complete([{ role: "user", content: "hi" }], { responseFormat: "json_object" }),
      /requires options\.jsonSchema/,
    );
  });

  test("defaults to json_object when structuredOutputMode unset", async () => {
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

function mockStreamFetch(chunks: string[], opts?: { delayMs?: number; throws?: Error }): FetchFn {
  return async () => {
    if (opts?.throws) throw opts.throws;
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        if (opts?.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      },
    });
    return {
      status: 200,
      ok: true,
      body: stream,
      headers: { get: () => null },
    } as unknown as Response;
  };
}

// SSE chunks for OpenAI-compat streaming. Each data line carries a JSON fragment with a delta.
function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const SSE_DONE = "data: [DONE]\n\n";

suite("OpenAICompatibleAdapter.completeStream", () => {
  test("yields text chunks in order from SSE response", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("Hello "),
      sseChunk("world"),
      SSE_DONE,
    ]));
    const collected: string[] = [];
    for await (const chunk of a.completeStream([{ role: "user", content: "hi" }])) {
      collected.push(chunk);
    }
    assert.deepStrictEqual(collected, ["Hello ", "world"]);
  });

  test("throws CancelledError when AbortSignal fires mid-stream", async () => {
    const controller = new AbortController();
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("Hello "),
      sseChunk("world"),
      SSE_DONE,
    ], { delayMs: 50 }));
    const iter = a.completeStream([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(async () => {
      for await (const _ of iter) { /* consume */ }
    }, /cancel/i);
  });

  test("throws StreamIdleTimeoutError when no chunk arrives within idleTimeoutMs", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([
      sseChunk("partial"),
      // then hang for a long time before [DONE]
    ], { delayMs: 500 }));
    const iter = a.completeStream([{ role: "user", content: "hi" }], {
      idleTimeoutMs: 100,
    });
    await assert.rejects(async () => {
      for await (const _ of iter) { /* consume */ }
    }, StreamIdleTimeoutError);
  });

  test("propagates NetworkError when fetch throws", async () => {
    const a = new OpenAICompatibleAdapter(CFG, mockStreamFetch([], { throws: new Error("boom") }));
    await assert.rejects(async () => {
      for await (const _ of a.completeStream([{ role: "user", content: "hi" }])) { /* consume */ }
    }, NetworkError);
  });

  test("propagates AuthError on HTTP 401", async () => {
    const fetchFn: FetchFn = async () => ({
      status: 401,
      ok: false,
      json: async () => ({ error: "unauthorized" }),
      text: async () => "unauthorized",
      headers: { get: () => null },
    } as unknown as Response);
    const a = new OpenAICompatibleAdapter(CFG, fetchFn);
    await assert.rejects(async () => {
      for await (const _ of a.completeStream([{ role: "user", content: "hi" }])) { /* consume */ }
    }, AuthError);
  });
});
