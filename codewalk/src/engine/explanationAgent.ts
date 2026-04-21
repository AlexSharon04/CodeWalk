import * as vscode from "vscode";
import type { Explanation, Segment, Concept } from "../types";
import type { JsonSchemaSpec, LLMAdapter, ChatMessage } from "../llm/adapter";
import {
  CancelledError,
  MalformedResponseError,
  AuthError,
  RateLimitError,
  StreamIdleTimeoutError,
} from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

export const EXPLANATION_PROMPT_VERSION = "v2";
export const DEFAULT_MAX_SEGMENT_LINES = 400;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

export const EXPLANATION_JSON_SCHEMA: JsonSchemaSpec = {
  name: "codewalk_explanation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      pointsToConsider: {
        type: "object",
        properties: {
          assumptions: { type: "array", items: { type: "string" } },
          dangers: { type: "array", items: { type: "string" } },
          sideEffects: { type: "array", items: { type: "string" } },
        },
        required: ["assumptions", "dangers", "sideEffects"],
        additionalProperties: false,
      },
      concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            briefExplainer: { type: "string" },
            relevance: { type: "string" },
          },
          required: ["name", "briefExplainer", "relevance"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "pointsToConsider", "concepts"],
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
  /** Phase 5 hook — always undefined in Phase 2. See docs/POST_MVP_VISION.md. */
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
  pointsToConsider?: {
    assumptions?: unknown;
    dangers?: unknown;
    sideEffects?: unknown;
  };
  concepts?: unknown;
}

// Task 5 — validation and retry.
export class ValidationFailure extends Error {}

const GENERIC_PTC_RE = /^(be careful|make sure|consider|note that|avoid|watch out|don[\u0027\u2019]t forget)\b/i;
const MIN_SUMMARY_LEN = 20;
const MIN_PTC_ITEM_LEN = 15;

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
    },
    deps.promptsDir,
  );

  const { system: baseSystem, user } = splitPrompt(prompt);

  const idleTimeoutMs = deps.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

  let firstRaw: string | undefined;
  let firstReason: string | undefined;
  let retryFired = false;
  const startMs = Date.now();

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
      // DIAG(bug-A): remove after Phase 2 streaming verified.
      const streamStartMs = Date.now();
      let chunkCount = 0;
      let partialCount = 0;
      let firstChunkMs: number | undefined;
      let firstPartialMs: number | undefined;
      try {
        const stream = deps.adapter.completeStream(messages, {
          responseFormat: "json_object",
          jsonSchema: EXPLANATION_JSON_SCHEMA,
          signal: ac.signal,
          idleTimeoutMs,
        });
        deps.logger?.(`[explain-diag] stream opened segmentId=${segment.id}`);
        for await (const chunk of streamWithIdleTimeout(stream, idleTimeoutMs, ac.signal)) {
          chunkCount++;
          if (firstChunkMs === undefined) firstChunkMs = Date.now() - streamStartMs;
          buffer += chunk;
          const partial = extractPartialSummary(buffer);
          if (partial !== undefined && partial.length > lastEmittedLength) {
            partialCount++;
            if (firstPartialMs === undefined) firstPartialMs = Date.now() - streamStartMs;
            deps.logger?.(`[explain-diag] partial #${partialCount} ms=${Date.now() - streamStartMs} len=${partial.length}`);
            deps.onPartial({ summary: partial });
            lastEmittedLength = partial.length;
          }
        }
        deps.logger?.(
          `[explain-diag] stream closed segmentId=${segment.id} totalMs=${Date.now() - streamStartMs} `
          + `chunks=${chunkCount} partials=${partialCount} `
          + `firstChunkMs=${firstChunkMs ?? -1} firstPartialMs=${firstPartialMs ?? -1} `
          + `bufferLen=${buffer.length}`,
        );
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
      const validated = validateResponse(raw, segment, deps.logger);
      const modelTimeMs = Date.now() - startMs;
      const prefix = retryFired ? "[explanation] WARN" : "[explanation]";
      deps.logger?.(
        `${prefix} segmentId=${segment.id} summary=${validated.summary.length}ch `
        + `assumptions=${validated.pointsToConsider.assumptions.length} `
        + `dangers=${validated.pointsToConsider.dangers.length} `
        + `sideEffects=${validated.pointsToConsider.sideEffects.length} `
        + `concepts=${validated.concepts.length} `
        + `modelTimeMs=${modelTimeMs} retryFired=${retryFired}`,
      );
      return {
        segmentId: segment.id,
        summary: validated.summary,
        pointsToConsider: validated.pointsToConsider,
        concepts: validated.concepts,
        renderState: "done",
      };
    } catch (err) {
      if (err instanceof ValidationFailure) {
        // DIAG(bug-C): remove after Phase 2 Anthropic path verified.
        deps.logger?.(`[explain-diag] validation failed attempt=${attempt} reason="${err.message}" rawPrefix=${JSON.stringify(raw.slice(0, 300))}`);
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
  // Pragmatic guess; production code can pull from vscode.TextDocument.languageId.
  return (segment as unknown as { languageId?: string }).languageId ?? "text";
}

function validateResponse(raw: string, segment: Segment, logger?: ExplanationLogger): {
  summary: string;
  pointsToConsider: Explanation["pointsToConsider"];
  concepts: Concept[];
} {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }

  if (typeof obj.summary !== "string" || obj.summary.length < MIN_SUMMARY_LEN) {
    throw new ValidationFailure(`summary is missing or shorter than ${MIN_SUMMARY_LEN} chars`);
  }
  if (obj.summary.trim().toLowerCase() === segment.oneLiner.trim().toLowerCase()) {
    throw new ValidationFailure("summary is identical to segment.oneLiner — agent must expand on the one-liner, not echo it");
  }

  const ptcIn = obj.pointsToConsider ?? {};
  const pointsToConsider = {
    assumptions: filterPtcItems(ptcIn.assumptions),
    dangers: filterPtcItems(ptcIn.dangers),
    sideEffects: filterPtcItems(ptcIn.sideEffects),
  };

  const conceptsRaw = Array.isArray(obj.concepts) ? obj.concepts : [];
  // DIAG(bug-B): remove after Phase 2 concepts rendering verified.
  logger?.(`[explain-diag] concepts raw count: ${conceptsRaw.length}; rawKeys=${JSON.stringify(conceptsRaw.map((c: any) => (c && typeof c === "object") ? Object.keys(c) : typeof c))}`);
  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const c of conceptsRaw) {
    if (!c || typeof (c as any).name !== "string" || (c as any).name.length === 0) {
      logger?.(`[explain-diag] concept dropped: missing/empty name; raw=${JSON.stringify(c).slice(0, 200)}`);
      continue;
    }
    if (typeof (c as any).briefExplainer !== "string" || (c as any).briefExplainer.length === 0) {
      logger?.(`[explain-diag] concept dropped: missing/empty briefExplainer; name="${(c as any).name}"`);
      continue;
    }
    if (typeof (c as any).relevance !== "string" || (c as any).relevance.length === 0) {
      logger?.(`[explain-diag] concept dropped: missing/empty relevance; name="${(c as any).name}"`);
      continue;
    }
    const key = (c as any).name.trim().toLowerCase();
    if (seen.has(key)) {
      logger?.(`[explain-diag] concept dropped: duplicate name="${(c as any).name}"`);
      continue;
    }
    seen.add(key);
    concepts.push({
      name: (c as any).name,
      briefExplainer: (c as any).briefExplainer,
      relevance: (c as any).relevance,
    });
  }

  return { summary: obj.summary, pointsToConsider, concepts };
}

function filterPtcItems(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter(
    (s): s is string =>
      typeof s === "string"
      && s.length >= MIN_PTC_ITEM_LEN
      && !GENERIC_PTC_RE.test(s.trim()),
  );
}
