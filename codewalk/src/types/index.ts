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

export type ExplanationKind = "trivial" | "logic" | "io";

export interface Explanation {
  segmentId: string;
  kind: ExplanationKind;
  purpose: string;
  flow: string[];
  uses: string[];
  produces: string[];
  watch: string[];
  concepts: Concept[];
  renderState: "streaming" | "done" | "error";
}
