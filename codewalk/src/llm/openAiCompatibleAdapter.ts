import {
  AuthError,
  CancelledError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
  StreamIdleTimeoutError,
  type ChatMessage,
  type CompleteOptions,
  type CompleteStreamOptions,
  type LLMAdapter,
} from "./adapter";

export interface AdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  structuredOutputMode?: "json_object" | "json_schema";
}

export type FetchFn = typeof fetch;

interface ChatResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
}

function buildResponseFormat(
  mode: "json_object" | "json_schema",
  jsonSchema: CompleteOptions["jsonSchema"],
): Record<string, unknown> {
  if (mode === "json_schema") {
    if (!jsonSchema) {
      throw new Error(
        "OpenAICompatibleAdapter: structuredOutputMode=json_schema requires options.jsonSchema to be provided by the caller.",
      );
    }
    return { type: "json_schema", json_schema: jsonSchema };
  }
  return { type: "json_object" };
}

async function* parseSseStream(
  response: Response,
  idleTimeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<{ chunk: string; bytes: number }> {
  if (!response.body) throw new NetworkError("Stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;

  // Set up idle timeout + abort cooperatively.
  const readWithTimeout = async (): Promise<{ value?: Uint8Array; done: boolean }> => {
    if (!idleTimeoutMs || idleTimeoutMs <= 0) return reader.read();
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new StreamIdleTimeoutError(idleTimeoutMs, totalBytes)),
        idleTimeoutMs,
      );
    });
    try {
      return await Promise.race([reader.read(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw new CancelledError();
      const { value, done } = await readWithTimeout();
      if (done) return;
      if (!value) continue;
      totalBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by \n\n. Each frame has one or more `data:` lines.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const obj = JSON.parse(payload);
            const content = obj?.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length > 0) {
              yield { chunk: content, bytes: totalBytes };
            }
          } catch {
            // Ignore malformed partial frames; SSE payloads are per-frame JSON.
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* ignore */ }
  }
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  constructor(
    private readonly cfg: AdapterConfig,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: 0.2,
    };
    if (options?.responseFormat === "json_object") {
      // Provider contracts differ: Anthropic's OAI-compat requires json_schema (strict shape),
      // Groq's default llama-3.3-70b only accepts json_object, and Ollama/OpenAI/others
      // accept either. The preset resolves the right choice and passes it here.
      const mode = this.cfg.structuredOutputMode ?? "json_object";
      body.response_format = buildResponseFormat(mode, options.jsonSchema);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (e) {
      if (options?.signal?.aborted || (e as Error).name === "AbortError") {
        throw new CancelledError();
      }
      throw new NetworkError(`Failed to reach ${url}: ${(e as Error).message}`, e);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Authentication failed (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
      throw new RateLimitError(`Rate limit exceeded (HTTP 429)`, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new NetworkError(`HTTP ${response.status}: ${text}`);
    }

    let parsed: ChatResponseBody;
    try {
      parsed = (await response.json()) as ChatResponseBody;
    } catch (e) {
      if (options?.signal?.aborted || (e as Error).name === "AbortError") {
        throw new CancelledError();
      }
      throw new MalformedResponseError(`Response body was not valid JSON: ${(e as Error).message}`);
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new MalformedResponseError(
        "Response did not contain choices[0].message.content",
        JSON.stringify(parsed),
      );
    }
    return content;
  }

  async *completeStream(
    messages: ChatMessage[],
    options: CompleteStreamOptions = {},
  ): AsyncGenerator<string> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: 0.2,
      stream: true,
    };
    if (options?.responseFormat === "json_object") {
      const mode = this.cfg.structuredOutputMode ?? "json_object";
      body.response_format = buildResponseFormat(mode, options.jsonSchema);
    }

    const signal = options.signal;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted || (e as Error).name === "AbortError") {
        throw new CancelledError();
      }
      throw new NetworkError(`Stream fetch failed: ${(e as Error).message}`, e);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Authentication failed (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : undefined;
      throw new RateLimitError(`Rate limit exceeded (HTTP 429)`, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable>");
      throw new NetworkError(`HTTP ${response.status}: ${text}`);
    }

    for await (const { chunk } of parseSseStream(response, options.idleTimeoutMs, signal)) {
      if (signal?.aborted) throw new CancelledError();
      yield chunk;
    }
  }
}
