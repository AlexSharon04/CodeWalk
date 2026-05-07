import * as vscode from "vscode";
import type { LineByLineDecorator } from "../editor/lineByLineDecorator";

export class LineByLineHoverProvider implements vscode.HoverProvider {
  constructor(private readonly decorator: LineByLineDecorator) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const full = this.decorator.fullForLine(document.uri, position.line + 1);
    if (!full) return undefined;
    const md = new vscode.MarkdownString(full, true);
    md.isTrusted = false;
    md.supportHtml = false;
    return new vscode.Hover(md, document.lineAt(position.line).range);
  }
}
