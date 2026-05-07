import * as vscode from "vscode";
import type { LineByLine, LineAnnotation, Segment } from "../types";
import type { JsonSchemaSpec, LLMAdapter, ChatMessage } from "../llm/adapter";
import { CancelledError, MalformedResponseError } from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

export const LINE_BY_LINE_PROMPT_VERSION = "v1";
export const DEFAULT_MAX_BLOCK_LINES = 200;
const MAX_SHORT_LEN = 60;
const MAX_FULL_LEN = 600;
const PREAMBLE_RE = /^\s*(here['’]?s|sure|certainly|of course|okay|alright)\b/i;
const FENCE_RE = /^\s*```/;

export const LINE_BY_LINE_JSON_SCHEMA: JsonSchemaSpec = {
  name: "codewalk_line_by_line",
  strict: true,
  schema: {
    type: "object",
    properties: {
      annotations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer" },
            short: { type: "string" },
            full: { type: "string" },
          },
          required: ["line", "short", "full"],
          additionalProperties: false,
        },
      },
    },
    required: ["annotations"],
    additionalProperties: false,
  },
};

export type LineByLineLogger = (msg: string) => void;

export interface LineByLineDeps {
  readonly adapter: LLMAdapter;
  readonly promptsDir: string;
  readonly logger?: LineByLineLogger;
  readonly token?: vscode.CancellationToken;
  readonly maxBlockLines?: number;
  readonly structuredOutputMode?: "json_object" | "json_schema";
}

export class LineByLineTooLargeError extends Error {
  constructor(
    public readonly segmentId: string,
    public readonly lineCount: number,
    public readonly maxLines: number,
  ) {
    super(
      `Block ${segmentId} has ${lineCount} lines; line-by-line currently supports blocks up to ${maxLines} lines.`,
    );
    this.name = "LineByLineTooLargeError";
  }
}

class ValidationFailure extends Error {}

interface RawAnnotation {
  line?: unknown;
  short?: unknown;
  full?: unknown;
}

interface RawResponse {
  annotations?: unknown;
}

export async function annotate(
  segment: Segment,
  deps: LineByLineDeps,
): Promise<LineByLine> {
  // Rule 1 — input guard.
  const maxLines = deps.maxBlockLines ?? DEFAULT_MAX_BLOCK_LINES;
  const lineCount = segment.endLine - segment.startLine + 1;
  if (lineCount > maxLines) {
    throw new LineByLineTooLargeError(segment.id, lineCount, maxLines);
  }
  throwIfCancelled(deps.token);

  const startMs = Date.now();
  const prompt = await loadPrompt(
    "lineByLine",
    {
      language: guessLanguage(segment),
      filename: "(unknown)",
      label: segment.label,
      oneLiner: segment.oneLiner,
      startLine: String(segment.startLine),
      endLine: String(segment.endLine),
      numberedBlockCode: numberLines(segment.code, segment.startLine),
    },
    deps.promptsDir,
  );

  const { system: baseSystem, user } = splitPrompt(prompt);

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

    const raw = await deps.adapter.complete(messages, {
      responseFormat: "json_object",
      jsonSchema: LINE_BY_LINE_JSON_SCHEMA,
      signal: toAbortSignal(deps.token),
    });

    try {
      const annotations = validateResponse(raw, segment);
      const modelTimeMs = Date.now() - startMs;
      const prefix = retryFired ? "[lineByLine] WARN" : "[lineByLine]";
      deps.logger?.(
        `${prefix} segmentId=${segment.id} annotations=${annotations.length} modelTimeMs=${modelTimeMs} retryFired=${retryFired}`,
      );
      return {
        segmentId: segment.id,
        annotations,
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

function toAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
  if (!token) return undefined;
  const ac = new AbortController();
  if (token.isCancellationRequested) ac.abort();
  token.onCancellationRequested(() => ac.abort());
  return ac.signal;
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

function numberLines(code: string, startLine: number): string {
  const lines = code.split("\n");
  return lines
    .map((line, i) => `${startLine + i}: ${line}`)
    .join("\n");
}

function validateResponse(raw: string, segment: Segment): LineAnnotation[] {
  let obj: RawResponse;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }

  if (!Array.isArray(obj.annotations)) {
    throw new ValidationFailure("annotations missing or not an array");
  }
  if (obj.annotations.length === 0) {
    throw new ValidationFailure("annotations array is empty — at least one line should be annotated");
  }

  const validated: LineAnnotation[] = [];
  const seenLines = new Set<number>();
  for (let i = 0; i < obj.annotations.length; i++) {
    const a = obj.annotations[i] as RawAnnotation;
    if (typeof a.line !== "number" || !Number.isInteger(a.line)) {
      throw new ValidationFailure(`annotations[${i}].line is missing or not an integer`);
    }
    if (a.line < segment.startLine || a.line > segment.endLine) {
      throw new ValidationFailure(
        `annotations[${i}].line=${a.line} is outside the block range [${segment.startLine}, ${segment.endLine}]`,
      );
    }
    if (typeof a.short !== "string" || a.short.length === 0) {
      throw new ValidationFailure(`annotations[${i}].short is missing or empty`);
    }
    if (a.short.length > MAX_SHORT_LEN) {
      throw new ValidationFailure(
        `annotations[${i}].short is ${a.short.length} chars; cap is ${MAX_SHORT_LEN}`,
      );
    }
    if (PREAMBLE_RE.test(a.short)) {
      throw new ValidationFailure(
        `annotations[${i}].short begins with a preamble (e.g. 'Here is') — return the annotation directly`,
      );
    }
    if (typeof a.full !== "string" || a.full.length === 0) {
      throw new ValidationFailure(`annotations[${i}].full is missing or empty`);
    }
    if (FENCE_RE.test(a.full)) {
      throw new ValidationFailure(
        `annotations[${i}].full begins with a Markdown fence — fences inline are fine, but not at position 0`,
      );
    }
    if (a.full.length > MAX_FULL_LEN) {
      throw new ValidationFailure(
        `annotations[${i}].full is ${a.full.length} chars; cap is ${MAX_FULL_LEN}`,
      );
    }
    if (seenLines.has(a.line)) {
      throw new ValidationFailure(`duplicate line ${a.line} in annotations`);
    }
    seenLines.add(a.line);
    validated.push({ line: a.line, short: a.short, full: a.full });
  }

  // Cross-item: ensure ascending order.
  for (let i = 1; i < validated.length; i++) {
    if (validated[i]!.line < validated[i - 1]!.line) {
      throw new ValidationFailure(
        `annotations not sorted ascending by line at index ${i}`,
      );
    }
  }

  return validated;
}
