export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface CompleteOptions {
  responseFormat?: "json_object" | "text";
}

export interface LLMAdapter {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class MalformedResponseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = "MalformedResponseError";
  }
}
