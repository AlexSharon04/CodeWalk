import * as vscode from "vscode";
import type { Segment } from "../types";

export class SegmentStore implements vscode.Disposable {
  private readonly map = new Map<string, Segment[]>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  get(uri: vscode.Uri): Segment[] | undefined {
    return this.map.get(uri.toString());
  }

  set(uri: vscode.Uri, segments: Segment[]): void {
    this.map.set(uri.toString(), segments);
    this._onDidChange.fire(uri);
  }

  clear(uri: vscode.Uri): void {
    if (this.map.delete(uri.toString())) {
      this._onDidChange.fire(uri);
    }
  }

  knownUris(): vscode.Uri[] {
    return Array.from(this.map.keys()).map(s => vscode.Uri.parse(s));
  }

  dispose(): void {
    this.map.clear();
    this._onDidChange.dispose();
  }
}
