import * as vscode from "vscode";
import type { Segment, Difficulty } from "../types";
import type { ChatMessage, LLMAdapter } from "../llm/adapter";
import { MalformedResponseError } from "../llm/adapter";
import { loadPrompt } from "../prompts/loader";

const RETRY_SYSTEM_ADDENDUM =
  "\n\nCRITICAL: your previous response was not valid JSON. Respond with ONLY the raw JSON object — no markdown fences, no commentary, no explanation. Begin your response with { and end with }.";

const VALID_DIFFICULTIES = new Set<Difficulty>(["trivial", "standard", "complex", "critical"]);

interface RawSegment {
  label?: unknown;
  oneLiner?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  difficulty?: unknown;
}

export interface SegmenterDeps {
  adapter: LLMAdapter;
  promptsDir: string;
}

export async function segment(
  document: vscode.TextDocument,
  deps: SegmenterDeps,
): Promise<Segment[]> {
  const numberedCode = numberLines(document.getText());
  const systemPrompt = loadPrompt(
    "segmentation",
    {
      language: document.languageId,
      filename: document.fileName,
      code: numberedCode,
    },
    deps.promptsDir,
  );

  const baseMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  let firstRaw: string | undefined;
  try {
    firstRaw = await deps.adapter.complete(baseMessages, { responseFormat: "json_object" });
    return parseAndValidate(firstRaw, document);
  } catch (firstError) {
    if (!(firstError instanceof ValidationFailure) && !(firstError instanceof MalformedResponseError)) {
      throw firstError;
    }
    const retryMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt + RETRY_SYSTEM_ADDENDUM },
    ];
    let secondRaw: string | undefined;
    try {
      secondRaw = await deps.adapter.complete(retryMessages, { responseFormat: "json_object" });
      return parseAndValidate(secondRaw, document);
    } catch (secondError) {
      throw new MalformedResponseError(
        "LLM did not return valid segment JSON after retry",
        JSON.stringify({ first: firstRaw, second: secondRaw ?? "<no response>" }),
      );
    }
  }
}

class ValidationFailure extends Error {}

function numberLines(text: string): string {
  return text.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n");
}

function parseAndValidate(raw: string, document: vscode.TextDocument): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationFailure("Response is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { segments?: unknown }).segments)) {
    throw new ValidationFailure("Response does not contain a 'segments' array");
  }
  const rawSegments = (parsed as { segments: RawSegment[] }).segments;
  const lineCount = document.lineCount;
  const validated: Segment[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const r = rawSegments[i];
    const startLine = Number(r.startLine);
    const endLine = Number(r.endLine);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const oneLiner = typeof r.oneLiner === "string" ? r.oneLiner.trim() : "";
    const difficulty = typeof r.difficulty === "string" ? r.difficulty : "";
    if (!Number.isInteger(startLine) || startLine < 1) continue;
    if (!Number.isInteger(endLine) || endLine < startLine) continue;
    if (endLine > lineCount) continue;
    if (label.length === 0 || oneLiner.length === 0) continue;
    if (!VALID_DIFFICULTIES.has(difficulty as Difficulty)) continue;
    const range = new vscode.Range(
      startLine - 1,
      0,
      Math.min(endLine, lineCount) - 1,
      Number.MAX_SAFE_INTEGER,
    );
    const codeText = document.getText(range);
    validated.push({
      id: `seg-${i}`,
      label,
      oneLiner,
      startLine,
      endLine,
      code: codeText,
      difficulty: difficulty as Difficulty,
    });
  }
  if (validated.length === 0) {
    throw new ValidationFailure("No segments passed validation");
  }
  return validated;
}
