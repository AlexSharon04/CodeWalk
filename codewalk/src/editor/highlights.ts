import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { Difficulty } from "../types";
import { isBlockHighlightsEnabled } from "../utils/config";

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  trivial:  "rgba(128, 128, 128, 0.06)",
  standard: "rgba(100, 149, 237, 0.08)",
  complex:  "rgba(255, 165, 0, 0.10)",
  critical: "rgba(220, 53, 69, 0.12)",
};

export class BlockHighlighter implements vscode.Disposable {
  private readonly decorationTypes: Record<Difficulty, vscode.TextEditorDecorationType>;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly store: SegmentStore) {
    this.decorationTypes = {
      trivial:  vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.trivial,  isWholeLine: true }),
      standard: vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.standard, isWholeLine: true }),
      complex:  vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.complex,  isWholeLine: true }),
      critical: vscode.window.createTextEditorDecorationType({ backgroundColor: DIFFICULTY_COLORS.critical, isWholeLine: true }),
    };
    this.subscriptions = [
      store.onDidChange((uri) => this.refreshUri(uri)),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this.applyToEditor(editor);
      }),
    ];
  }

  private refreshUri(uri: vscode.Uri): void {
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === uri.toString(),
    );
    for (const editor of editors) this.applyToEditor(editor);
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const enabled = isBlockHighlightsEnabled();
    const segments = this.store.get(editor.document.uri) ?? [];
    const grouped: Record<Difficulty, vscode.Range[]> = {
      trivial: [],
      standard: [],
      complex: [],
      critical: [],
    };
    if (enabled) {
      for (const seg of segments) {
        grouped[seg.difficulty].push(
          new vscode.Range(seg.startLine - 1, 0, seg.endLine - 1, Number.MAX_SAFE_INTEGER),
        );
      }
    }
    for (const diff of Object.keys(grouped) as Difficulty[]) {
      editor.setDecorations(this.decorationTypes[diff], grouped[diff]);
    }
  }

  dispose(): void {
    for (const dt of Object.values(this.decorationTypes)) dt.dispose();
    for (const s of this.subscriptions) s.dispose();
  }
}
