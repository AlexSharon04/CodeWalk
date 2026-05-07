import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { Difficulty } from "../types";

const ICON_BY_DIFFICULTY: Record<Difficulty, string> = {
  trivial: "$(circle-outline)",
  standard: "$(circle-filled)",
  complex: "$(warning)",
  critical: "$(error)",
};

export class CodeWalkLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private readonly storeSubscription: vscode.Disposable;

  constructor(private readonly store: SegmentStore) {
    this.storeSubscription = store.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const segments = this.store.get(document.uri) ?? [];
    return segments.map((seg) => {
      const range = new vscode.Range(seg.startLine - 1, 0, seg.startLine - 1, 0);
      const icon = ICON_BY_DIFFICULTY[seg.difficulty];
      return new vscode.CodeLens(range, {
        title: `${icon} ${seg.label} — ${seg.oneLiner}`,
        command: "codewalk.expandBlock",
        arguments: [seg.id],
      });
    });
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    this.storeSubscription.dispose();
  }
}
