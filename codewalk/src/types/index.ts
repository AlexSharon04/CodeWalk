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
