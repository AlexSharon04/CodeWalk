import * as vscode from "vscode";
import type { LineAnnotation } from "../types";

/**
 * Renders per-line `after.contentText` annotations using ONE shared
 * TextEditorDecorationType across every range, regardless of how many lines
 * are annotated or how many editors are visible. This is the design-doc
 * §12.5 leak guard — creating a fresh TextEditorDecorationType per line is
 * the most common memory leak in VS Code extensions.
 *
 * The per-line text is carried by `DecorationOptions.renderOptions.after.contentText`
 * (per-range), not by the type itself.
 */
export class LineByLineDecorator implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;
  private readonly active = new Map<string, Map<number, string>>();
  private readonly options = new Map<string, vscode.DecorationOptions[]>();
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    this.type = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 2em",
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
      },
    });
    this.subs.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const ed of editors) this.applyToEditor(ed);
      }),
    );
  }

  apply(uri: vscode.Uri, annotations: readonly LineAnnotation[]): void {
    const opts: vscode.DecorationOptions[] = annotations.map((a) => ({
      range: new vscode.Range(a.line - 1, 0, a.line - 1, Number.MAX_SAFE_INTEGER),
      renderOptions: { after: { contentText: `  ⟵ ${a.short}` } },
    }));
    this.options.set(uri.toString(), opts);

    const fullMap = new Map<number, string>();
    for (const a of annotations) fullMap.set(a.line, a.full);
    this.active.set(uri.toString(), fullMap);

    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri.toString()) {
        ed.setDecorations(this.type, opts);
      }
    }
  }

  clear(uri: vscode.Uri): void {
    const had = this.options.delete(uri.toString());
    this.active.delete(uri.toString());
    if (!had) return;
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri.toString()) {
        ed.setDecorations(this.type, []);
      }
    }
  }

  clearAll(): void {
    const uris = Array.from(this.options.keys());
    this.options.clear();
    this.active.clear();
    for (const ed of vscode.window.visibleTextEditors) {
      if (uris.includes(ed.document.uri.toString())) {
        ed.setDecorations(this.type, []);
      }
    }
  }

  hasUri(uri: vscode.Uri): boolean {
    return this.active.has(uri.toString());
  }

  fullForLine(uri: vscode.Uri, line: number): string | undefined {
    return this.active.get(uri.toString())?.get(line);
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const opts = this.options.get(editor.document.uri.toString());
    if (opts) editor.setDecorations(this.type, opts);
  }

  dispose(): void {
    this.type.dispose();
    for (const s of this.subs) s.dispose();
    this.active.clear();
    this.options.clear();
  }
}
