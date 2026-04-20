import {
  AuthError,
  CancelledError,
  MalformedResponseError,
  NetworkError,
  RateLimitError,
  type ChatMessage,
  type CompleteOptions,
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

// Hardcoded here until Phase 2 introduces a second schema and forces a proper
// per-call `jsonSchema` option on CompleteOptions. Groq's newer models reject
// `response_format: {type: "json_object"}` and require this strict form.
const SEGMENT_JSON_SCHEMA = {
  name: "codewalk_segments",
  strict: true,
  schema: {
    type: "object",
    properties: {
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            oneLiner: { type: "string" },
            startLine: { type: "integer" },
            endLine: { type: "integer" },
            difficulty: {
              type: "string",
              enum: ["trivial", "standard", "complex", "critical"],
            },
          },
          required: ["label", "oneLiner", "startLine", "endLine", "difficulty"],
          additionalProperties: false,
        },
      },
    },
    required: ["segments"],
    additionalProperties: false,
  },
} as const;

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
      body.response_format =
        mode === "json_schema"
          ? { type: "json_schema", json_schema: SEGMENT_JSON_SCHEMA }
          : { type: "json_object" };
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
}
