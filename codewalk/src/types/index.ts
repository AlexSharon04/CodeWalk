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

export interface Concept {
  name: string;
  briefExplainer: string;
  relevance: string;
}

export interface Explanation {
  segmentId: string;
  summary: string;
  pointsToConsider: {
    assumptions: string[];
    dangers: string[];
    sideEffects: string[];
  };
  concepts: Concept[];
  renderState: "streaming" | "done" | "error";
}
