export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface CompleteOptions {
  responseFormat?: "json_object" | "text";
  signal?: AbortSignal;
}

export interface CompleteStreamOptions extends CompleteOptions {
  /** Milliseconds without a chunk before aborting the stream. 0 or undefined = no timeout. */
  idleTimeoutMs?: number;
}

export class CancelledError extends Error {
  constructor(message = "Operation cancelled by user") {
    super(message);
    this.name = "CancelledError";
  }
}

export class StreamIdleTimeoutError extends Error {
  constructor(
    public readonly idleMs: number,
    public readonly bytesReceived: number,
  ) {
    super(`No stream chunks received for ${idleMs}ms (${bytesReceived} bytes received so far).`);
    this.name = "StreamIdleTimeoutError";
  }
}

export interface LLMAdapter {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
  completeStream(messages: ChatMessage[], options?: CompleteStreamOptions): AsyncIterable<string>;
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
