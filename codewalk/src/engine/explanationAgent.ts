import * as vscode from "vscode";
import type { Explanation, Segment, Concept } from "../types";
import type { ChatMessage, LLMAdapter } from "../llm/adapter";
import { CancelledError, MalformedResponseError } from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

export const EXPLANATION_PROMPT_VERSION = "v1";
export const DEFAULT_MAX_SEGMENT_LINES = 400;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

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

// Task 5 will switch to throwing ValidationFailure on retry exhaustion; left here as placeholder.
// Exported to mark it for future use in retry logic without triggering unused-variable warnings.
export class ValidationFailure extends Error {}

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
      additionalContext: deps.additionalContext ?? "",
    },
    deps.promptsDir,
  );

  const { system, user } = splitPrompt(prompt);

  const baseMessages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const raw = await deps.adapter.complete(baseMessages, {
    responseFormat: "json_object",
  });

  // Rule 2 — parse. Rules 3–4 land in Task 5.
  const parsed = parseAndValidate(raw, segment);
  return {
    segmentId: segment.id,
    summary: parsed.summary,
    pointsToConsider: parsed.pointsToConsider,
    concepts: parsed.concepts,
    renderState: "done",
  };
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

function parseAndValidate(raw: string, _segment: Segment): {
  summary: string;
  pointsToConsider: Explanation["pointsToConsider"];
  concepts: Concept[];
} {
  let obj: RawExplanation;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new MalformedResponseError("response is not valid JSON", raw);
  }

  if (typeof obj.summary !== "string" || obj.summary.length < 20) {
    throw new MalformedResponseError("summary missing or too short", raw);
  }

  const ptc = obj.pointsToConsider ?? {};
  const pointsToConsider = {
    assumptions: arrayOfStrings(ptc.assumptions),
    dangers: arrayOfStrings(ptc.dangers),
    sideEffects: arrayOfStrings(ptc.sideEffects),
  };

  const concepts = Array.isArray(obj.concepts)
    ? obj.concepts
        .filter((c: any) =>
          c && typeof c.name === "string" && c.name.length > 0
          && typeof c.briefExplainer === "string" && c.briefExplainer.length > 0
          && typeof c.relevance === "string" && c.relevance.length > 0,
        )
        .map((c: any): Concept => ({
          name: c.name,
          briefExplainer: c.briefExplainer,
          relevance: c.relevance,
        }))
    : [];

  return { summary: obj.summary, pointsToConsider, concepts };
}

function arrayOfStrings(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
}
