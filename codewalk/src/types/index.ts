export type Difficulty = "trivial" | "standard" | "complex" | "critical";

export interface Segment {
  id: string;
  label: string;
  oneLiner: string;
  startLine: number;
  endLine: number;
  code: string;
  difficulty: Difficulty;
}

export interface Explanation {
  segmentId: string;
  summary: string;
  renderState: "streaming" | "done" | "error";
}

export interface LineAnnotation {
  /** Absolute file line number, 1-indexed. */
  line: number;
  /** Inline rendering — plain text, ≤ 60 chars. Rendered as `after.contentText`. */
  short: string;
  /** Hover body — markdown source. */
  full: string;
}

export interface LineByLine {
  segmentId: string;
  annotations: LineAnnotation[];
  renderState: "done" | "error";
}
