import * as vscode from "vscode";
import type { Explanation, Segment, Concept } from "../types";
import type { LLMAdapter } from "../llm/adapter";
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

// Task 5 — validation and retry.
export class ValidationFailure extends Error {}

const GENERIC_PTC_RE = /^(be careful|make sure|consider|note that|avoid|watch out|don't forget)\b/i;
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
      additionalContext: deps.additionalContext ?? "",
    },
    deps.promptsDir,
  );

  const { system: baseSystem, user } = splitPrompt(prompt);

  let firstRaw: string | undefined;
  let firstReason: string | undefined;
  const useJsonSchema = deps.structuredOutputMode === "json_schema";

  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled(deps.token);

    const system = attempt === 0
      ? baseSystem
      : `${baseSystem}\n\nCRITICAL: your previous response failed validation: ${firstReason ?? "unknown"}. Respond with ONLY the raw JSON object matching the schema. No preamble, no Markdown fence.`;

    const raw = await deps.adapter.complete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { responseFormat: useJsonSchema ? "json_object" : "json_object" },
    );

    try {
      const validated = validateResponse(raw, segment);
      return {
        segmentId: segment.id,
        summary: validated.summary,
        pointsToConsider: validated.pointsToConsider,
        concepts: validated.concepts,
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
  // Pragmatic guess; production code can pull from vscode.TextDocument.languageId.
  return (segment as unknown as { languageId?: string }).languageId ?? "text";
}

function validateResponse(raw: string, segment: Segment): {
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
  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const c of conceptsRaw) {
    if (!c || typeof (c as any).name !== "string" || (c as any).name.length === 0) continue;
    if (typeof (c as any).briefExplainer !== "string" || (c as any).briefExplainer.length === 0) continue;
    if (typeof (c as any).relevance !== "string" || (c as any).relevance.length === 0) continue;
    const key = (c as any).name.trim().toLowerCase();
    if (seen.has(key)) continue;
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
