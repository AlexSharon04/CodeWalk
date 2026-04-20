import * as vscode from "vscode";
import type { Explanation, Segment } from "../types";
import type { LLMAdapter } from "../llm/adapter";

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

export async function explain(
  _segment: Segment,
  _fileContext: string,
  _deps: ExplanationDeps,
): Promise<Explanation> {
  throw new Error("not implemented yet — Task 4");
}
