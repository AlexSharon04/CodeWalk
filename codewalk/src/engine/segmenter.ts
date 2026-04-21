import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { Segment, Difficulty } from "../types";
import type { ChatMessage, JsonSchemaSpec, LLMAdapter } from "../llm/adapter";
import { CancelledError, MalformedResponseError } from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

const VALID_DIFFICULTIES = new Set<Difficulty>(["trivial", "standard", "complex", "critical"]);

export const DEFAULT_MAX_LINES = 2000;
export const MIN_COVERAGE_RATIO = 0.7;

export const SEGMENT_JSON_SCHEMA: JsonSchemaSpec = {
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
};

export class FileTooLargeError extends Error {
  constructor(
    public readonly lineCount: number,
    public readonly maxLines: number,
  ) {
    super(
      `File has ${lineCount} lines; CodeWalk currently supports files up to ${maxLines} lines.`,
    );
    this.name = "FileTooLargeError";
  }
}

export type SegmenterLogger = (message: string) => void;

export interface SegmenterDeps {
  adapter: LLMAdapter;
  promptsDir: string;
  maxLines?: number;
  logger?: SegmenterLogger;
  token?: vscode.CancellationToken;
}

interface RawSegment {
  label?: unknown;
  oneLiner?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  difficulty?: unknown;
}

interface ValidatedSegment {
  label: string;
  oneLiner: string;
  startLine: number;
  endLine: number;
  difficulty: Difficulty;
}

interface ParseResult {
  segments: ValidatedSegment[];
  droppedCount: number;
}

class ValidationFailure extends Error {}

export async function segment(
  document: vscode.TextDocument,
  deps: SegmenterDeps,
): Promise<Segment[]> {
  const maxLines = deps.maxLines ?? DEFAULT_MAX_LINES;
  if (document.lineCount > maxLines) {
    throw new FileTooLargeError(document.lineCount, maxLines);
  }

  const log = deps.logger ?? noop;
  const signal = toAbortSignal(deps.token);
  throwIfCancelled(deps.token);

  const numberedCode = numberLines(document.getText());
  const fullPrompt = loadPrompt(
    "segmentation",
    {
      language: document.languageId,
      filename: document.fileName,
      code: numberedCode,
    },
    deps.promptsDir,
  );
  const { system: systemPrompt, user: userPrompt } = splitSystemUser(fullPrompt);

  const baseMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let firstRaw: string | undefined;
  let firstFailureReason: string | undefined;
  try {
    firstRaw = await deps.adapter.complete(baseMessages, {
      responseFormat: "json_object",
      jsonSchema: SEGMENT_JSON_SCHEMA,
      signal,
    });
    return finalize(parseAndValidate(firstRaw, document), document, log);
  } catch (firstError) {
    if (firstError instanceof CancelledError) throw firstError;
    if (firstError instanceof ValidationFailure) {
      firstFailureReason = firstError.message;
    } else if (firstError instanceof MalformedResponseError) {
      firstFailureReason = "response was not valid JSON";
    } else {
      throw firstError;
    }

    throwIfCancelled(deps.token);

    const retrySystem =
      systemPrompt +
      `\n\nCRITICAL: your previous response failed validation: ${firstFailureReason}. Respond with ONLY the raw JSON object matching the schema — no markdown fences, no commentary, no explanation. Begin with { and end with }.`;
    const retryMessages: ChatMessage[] = [
      { role: "system", content: retrySystem },
      { role: "user", content: userPrompt },
    ];

    let secondRaw: string | undefined;
    try {
      secondRaw = await deps.adapter.complete(retryMessages, {
        responseFormat: "json_object",
        jsonSchema: SEGMENT_JSON_SCHEMA,
        signal,
      });
      return finalize(parseAndValidate(secondRaw, document), document, log);
    } catch (secondError) {
      if (secondError instanceof CancelledError) throw secondError;
      throw new MalformedResponseError(
        `LLM did not return valid segment JSON after retry. First failure: ${firstFailureReason}. Second failure: ${(secondError as Error).message ?? String(secondError)}`,
        JSON.stringify({ first: firstRaw, second: secondRaw ?? "<no response>" }),
      );
    }
  }
}

function toAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
  if (!token) return undefined;
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) throw new CancelledError();
}

function numberLines(text: string): string {
  return text.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n");
}

// Split the substituted prompt into system (instructions) and user (the actual input) halves.
// Anthropic's OAI-compat endpoint rejects requests with only a system message; splitting
// also matches standard chat-template convention (rules in system, ask in user).
function splitSystemUser(prompt: string): { system: string; user: string } {
  const marker = "## Input";
  const idx = prompt.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `Segmentation prompt missing "${marker}" section header — cannot split into system/user messages.`,
    );
  }
  return {
    system: prompt.slice(0, idx).trim(),
    user: prompt.slice(idx + marker.length).trim(),
  };
}

function parseAndValidate(raw: string, document: vscode.TextDocument): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("response is not valid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { segments?: unknown }).segments)
  ) {
    throw new ValidationFailure("response does not contain a 'segments' array");
  }

  const rawSegments = (parsed as { segments: RawSegment[] }).segments;
  const lineCount = document.lineCount;
  const validated: ValidatedSegment[] = [];
  let droppedCount = 0;

  for (const r of rawSegments) {
    const startLine = Number(r.startLine);
    let endLine = Number(r.endLine);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const oneLiner = typeof r.oneLiner === "string" ? r.oneLiner.trim() : "";
    const difficulty = typeof r.difficulty === "string" ? r.difficulty : "";

    if (!Number.isInteger(startLine) || startLine < 1) { droppedCount++; continue; }
    if (!Number.isInteger(endLine)) { droppedCount++; continue; }
    if (endLine > lineCount) endLine = lineCount;
    if (endLine < startLine) { droppedCount++; continue; }
    if (label.length === 0 || oneLiner.length === 0) { droppedCount++; continue; }
    if (!VALID_DIFFICULTIES.has(difficulty as Difficulty)) { droppedCount++; continue; }

    validated.push({ label, oneLiner, startLine, endLine, difficulty: difficulty as Difficulty });
  }

  if (validated.length === 0) {
    throw new ValidationFailure("no segments passed per-field validation");
  }

  validated.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  for (let i = 1; i < validated.length; i++) {
    const prev = validated[i - 1];
    const curr = validated[i];
    if (curr.startLine <= prev.endLine) {
      throw new ValidationFailure(
        `segments overlap: "${prev.label}" (lines ${prev.startLine}-${prev.endLine}) and "${curr.label}" (lines ${curr.startLine}-${curr.endLine})`,
      );
    }
  }

  return { segments: validated, droppedCount };
}

function finalize(
  parsed: ParseResult,
  document: vscode.TextDocument,
  log: SegmenterLogger,
): Segment[] {
  const { segments, droppedCount } = parsed;
  const lineCount = document.lineCount;

  const finalized: Segment[] = segments.map((s) => {
    const range = new vscode.Range(
      s.startLine - 1,
      0,
      Math.min(s.endLine, lineCount) - 1,
      Number.MAX_SAFE_INTEGER,
    );
    const code = document.getText(range);
    return {
      id: computeSegmentId(s.label, s.startLine, s.endLine, code),
      label: s.label,
      oneLiner: s.oneLiner,
      startLine: s.startLine,
      endLine: s.endLine,
      code,
      difficulty: s.difficulty,
    };
  });

  const coverage = computeCoverage(finalized, document);
  log(
    `[segmenter] ${finalized.length} segment(s), coverage ${(coverage * 100).toFixed(0)}%` +
      (droppedCount > 0 ? `, dropped ${droppedCount}` : ""),
  );
  if (coverage < MIN_COVERAGE_RATIO) {
    log(
      `[segmenter] WARN coverage below ${Math.round(MIN_COVERAGE_RATIO * 100)}% — some non-blank lines were not segmented`,
    );
  }

  return finalized;
}

function computeCoverage(segments: Segment[], document: vscode.TextDocument): number {
  const covered = new Set<number>();
  for (const s of segments) {
    for (let line = s.startLine; line <= s.endLine; line++) {
      covered.add(line);
    }
  }
  let nonBlankTotal = 0;
  let nonBlankCovered = 0;
  for (let i = 0; i < document.lineCount; i++) {
    if (document.lineAt(i).text.trim().length === 0) continue;
    nonBlankTotal++;
    if (covered.has(i + 1)) nonBlankCovered++;
  }
  return nonBlankTotal === 0 ? 1 : nonBlankCovered / nonBlankTotal;
}

function noop(): void {
  /* swallow logs when no logger injected */
}

function computeSegmentId(label: string, startLine: number, endLine: number, code: string): string {
  // Content-derived so re-segmenting unchanged code yields the same id; downstream
  // phase-2 thread persistence can key panel state on this without drift on re-runs.
  const hash = createHash("sha256");
  hash.update(`${label}\u0000${startLine}\u0000${endLine}\u0000${code}`);
  return `seg-${hash.digest("hex").slice(0, 12)}`;
}
