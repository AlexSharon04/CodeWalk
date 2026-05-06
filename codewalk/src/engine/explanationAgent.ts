import * as vscode from "vscode";
import type { Explanation, Segment } from "../types";
import type { JsonSchemaSpec, LLMAdapter, ChatMessage } from "../llm/adapter";
import {
  CancelledError,
  MalformedResponseError,
  AuthError,
  RateLimitError,
  StreamIdleTimeoutError,
} from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

export const EXPLANATION_PROMPT_VERSION = "v3";
export const DEFAULT_MAX_SEGMENT_LINES = 400;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

export const EXPLANATION_JSON_SCHEMA: JsonSchemaSpec = {
  name: "codewalk_explanation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

const SUMMARY_RE = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/;

export function extractPartialSummary(buffer: string): string | undefined {
  const match = SUMMARY_RE.exec(buffer);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return undefined;
  }
}

async function* streamWithIdleTimeout(
  iter: AsyncIterable<string>,
  idleTimeoutMs: number,
  _signal: AbortSignal,
): AsyncGenerator<string> {
  const iterator = iter[Symbol.asyncIterator]();
  while (true) {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      if (idleTimeoutMs > 0) {
        timeoutId = setTimeout(() => reject(new Error("__idle__")), idleTimeoutMs);
      }
    });
    try {
      const { value, done } = await Promise.race([iterator.next(), timeoutPromise]);
      if (done) return;
      if (value === undefined) return;
      yield value;
    } catch (err) {
      if ((err as Error).message === "__idle__") throw err;
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

export type ExplanationLogger = (message: string) => void;

export interface ExplanationDeps {
  readonly adapter: LLMAdapter;
  readonly promptsDir: string;
  readonly logger?: ExplanationLogger;
  readonly token?: vscode.CancellationToken;
  readonly onPartial?: (partial: { summary?: string }) => void;
  /** Phase 5 hook — always undefined in Phase 2/3. See docs/POST_MVP_VISION.md. */
  readonly additionalContext?: string;
  /** Override for tests. */
  readonly maxSegmentLines?: number;
  readonly streamIdleTimeoutMs?: number;
  /** Preset key for `structuredOutputMode`; selects json_schema vs json_object. */
  readonly structuredOutputMode?: "json_object" | "json_schema";
}

export class SegmentTooLargeError extends Error {
  constructor(
    public readonly segmentId: string,
    public readonly lineCount: number,
    public readonly maxLines: number,
  ) {
    super(
      `Segment ${segmentId} has ${lineCount} lines; CodeWalk currently supports blocks up to ${maxLines} lines.`,
    );
    this.name = "SegmentTooLargeError";
  }
}

export class ExplanationStreamError extends Error {
  constructor(
    public readonly segmentId: string,
    public readonly partialBytes: number,
    public readonly cause: "network" | "provider-terminated" | "parse-never-ready",
  ) {
    super(
      `Explanation stream for ${segmentId} ended prematurely (${partialBytes} bytes received, cause: ${cause}).`,
    );
    this.name = "ExplanationStreamError";
  }
}

interface RawExplanation {
  summary?: unknown;
}

export class ValidationFailure extends Error {}

const MIN_SUMMARY_LEN = 40;
const MAX_SUMMARY_LEN = 700;
const PREAMBLE_RE = /^\s*(here['’]?s|sure|certainly|of course|okay|alright)\b/i;
const FENCE_RE = /^\s*```/;

export function synthesizeTrivial(segment: Segment): Explanation {
  return {
    segmentId: segment.id,
    summary: segment.oneLiner,
    renderState: "done",
  };
}

export async function explain(
  segment: Segment,
  fileContext: string,
  deps: ExplanationDeps,
): Promise<Explanation> {
  // Rule 1 — input guard.
  const maxLines = deps.maxSegmentLines ?? DEFAULT_MAX_SEGMENT_LINES;
  const lineCount = segment.endLine - segment.startLine + 1;
  if (lineCount > maxLines) {
    throw new SegmentTooLargeError(segment.id, lineCount, maxLines);
  }

  throwIfCancelled(deps.token);

  const startMs = Date.now();

  if (segment.difficulty === "trivial") {
    const exp = synthesizeTrivial(segment);
    const modelTimeMs = Date.now() - startMs;
    deps.logger?.(
      `[explanation] segmentId=${segment.id} source=synth summaryChars=${exp.summary.length} modelTimeMs=${modelTimeMs}`,
    );
    return exp;
  }

  const prompt = await loadPrompt(
    "explanation",
    {
      language: guessLanguage(segment),
      filename: "(unknown)",
      label: segment.label,
      startLine: String(segment.startLine),
      endLine: String(segment.endLine),
      blockCode: segment.code,
      fileContext: fileContext,
      additionalContext: deps.additionalContext ? `Prior context:\n${deps.additionalContext}` : "",
      difficulty: segment.difficulty,
    },
    deps.promptsDir,
  );

  const { system: baseSystem, user } = splitPrompt(prompt);

  const idleTimeoutMs = deps.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

  let firstRaw: string | undefined;
  let firstReason: string | undefined;
  let retryFired = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) retryFired = true;
    throwIfCancelled(deps.token);

    const system = attempt === 0
      ? baseSystem
      : `${baseSystem}\n\nCRITICAL: your previous response failed validation: ${firstReason ?? "unknown"}. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.`;

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    let raw: string;
    if (attempt === 0 && deps.onPartial) {
      const ac = new AbortController();
      const tokenSub = deps.token?.onCancellationRequested(() => ac.abort());
      let buffer = "";
      let lastEmittedLength = 0;
      try {
        const stream = deps.adapter.completeStream(messages, {
          responseFormat: "json_object",
          jsonSchema: EXPLANATION_JSON_SCHEMA,
          signal: ac.signal,
          idleTimeoutMs,
        });
        for await (const chunk of streamWithIdleTimeout(stream, idleTimeoutMs, ac.signal)) {
          buffer += chunk;
          const partial = extractPartialSummary(buffer);
          if (partial !== undefined && partial.length > lastEmittedLength) {
            deps.onPartial({ summary: partial });
            lastEmittedLength = partial.length;
          }
        }
        raw = buffer;
      } catch (err) {
        if (tokenSub) tokenSub.dispose();
        if (err instanceof CancelledError) throw err;
        if (err instanceof AuthError || err instanceof RateLimitError) throw err;
        if ((err as Error).message === "__idle__" || err instanceof StreamIdleTimeoutError) {
          throw new ExplanationStreamError(segment.id, buffer.length, "provider-terminated");
        }
        throw new ExplanationStreamError(segment.id, buffer.length, "network");
      } finally {
        if (tokenSub) tokenSub.dispose();
      }
    } else {
      raw = await deps.adapter.complete(
        messages,
        { responseFormat: "json_object", jsonSchema: EXPLANATION_JSON_SCHEMA },
      );
    }

    try {
      const summary = validateResponse(raw, segment);
      const modelTimeMs = Date.now() - startMs;
      const prefix = retryFired ? "[explanation] WARN" : "[explanation]";
      deps.logger?.(
        `${prefix} segmentId=${segment.id} source=llm summaryChars=${summary.length} modelTimeMs=${modelTimeMs} retryFired=${retryFired}`,
      );
      return {
        segmentId: segment.id,
        summary,
        renderState: "done",
      };
    } catch (err) {
      if (err instanceof ValidationFailure) {
        if (attempt === 0) {
          firstRaw = raw;
          firstReason = err.message;
          continue;
        }
        throw new MalformedResponseError(
          `validation failed on both attempts: ${err.message}`,
          JSON.stringify({ first: firstRaw, second: raw }),
        );
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) throw new CancelledError();
}

function splitPrompt(prompt: string): { system: string; user: string } {
  const marker = "## Input";
  const idx = prompt.indexOf(marker);
  if (idx < 0) return { system: prompt, user: "" };
  return {
    system: prompt.slice(0, idx).trim(),
    user: prompt.slice(idx + marker.length).trim(),
  };
}

function guessLanguage(segment: Segment): string {
  return (segment as unknown as { languageId?: string }).languageId ?? "text";
}

function validateResponse(raw: string, segment: Segment): string {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }

  if (typeof obj.summary !== "string") {
    throw new ValidationFailure("summary is missing or not a string");
  }
  const summary = obj.summary;

  if (FENCE_RE.test(summary)) {
    throw new ValidationFailure("summary begins with a Markdown fence — return raw text only");
  }
  if (PREAMBLE_RE.test(summary)) {
    throw new ValidationFailure("summary begins with a preamble (e.g. 'Sure', 'Here is') — return the explanation directly");
  }
  if (summary.length < MIN_SUMMARY_LEN) {
    throw new ValidationFailure(`summary is shorter than ${MIN_SUMMARY_LEN} chars`);
  }
  if (summary.length > MAX_SUMMARY_LEN) {
    throw new ValidationFailure(`summary is longer than ${MAX_SUMMARY_LEN} chars — keep it to 3–5 sentences`);
  }
  if (summary.trim().toLowerCase() === segment.oneLiner.trim().toLowerCase()) {
    throw new ValidationFailure("summary is identical to segment.oneLiner — expand on it, don't echo it");
  }

  return summary;
}
