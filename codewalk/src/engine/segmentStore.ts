import * as vscode from "vscode";
import type { Segment, Difficulty } from "../types";

const KEY_PREFIX = "segments:";

function isSegment(x: unknown): x is Segment {
  if (!x || typeof x !== "object") return false;
  const o = x as Segment;
  const validDifficulty: Difficulty[] = ["trivial", "standard", "complex", "critical"];
  return (
    typeof o.id === "string"
    && typeof o.label === "string"
    && typeof o.oneLiner === "string"
    && typeof o.startLine === "number"
    && typeof o.endLine === "number"
    && typeof o.code === "string"
    && validDifficulty.includes(o.difficulty)
  );
}

export class SegmentStore implements vscode.Disposable {
  private readonly map = new Map<string, Segment[]>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly memento?: vscode.Memento,
    private readonly logger?: (msg: string) => void,
  ) {}

  /**
   * Restore persisted segments from the memento and fire onDidChange for each.
   * Call this AFTER all listeners (highlighter, lens provider, etc.) are wired
   * — events fired before subscribers attach are lost.
   */
  rehydrate(): void {
    if (!this.memento) return;
    let restored = 0;
    let dropped = 0;
    for (const key of this.memento.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const uriString = key.slice(KEY_PREFIX.length);
      const value = this.memento.get<unknown>(key);
      if (!Array.isArray(value) || !value.every(isSegment)) {
        this.logger?.(`[segmentStore] WARN dropping malformed entry ${key}`);
        void this.memento.update(key, undefined);
        dropped++;
        continue;
      }
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(uriString);
      } catch {
        this.logger?.(`[segmentStore] WARN dropping unparseable URI ${uriString}`);
        void this.memento.update(key, undefined);
        dropped++;
        continue;
      }
      this.map.set(uri.toString(), value);
      this._onDidChange.fire(uri);
      restored++;
    }
    if (restored > 0 || dropped > 0) {
      this.logger?.(`[segmentStore] rehydrated=${restored} dropped=${dropped}`);
    }
  }

  get(uri: vscode.Uri): Segment[] | undefined {
    return this.map.get(uri.toString());
  }

  set(uri: vscode.Uri, segments: Segment[]): void {
    this.map.set(uri.toString(), segments);
    this._onDidChange.fire(uri);
    this.persistOne(uri, segments);
  }

  clear(uri: vscode.Uri): void {
    if (this.map.delete(uri.toString())) {
      this._onDidChange.fire(uri);
      this.persistOne(uri, undefined);
    }
  }

  clearAll(): void {
    const uris = this.knownUris();
    this.map.clear();
    for (const uri of uris) this._onDidChange.fire(uri);
    if (this.memento) {
      for (const uri of uris) {
        void this.memento.update(`${KEY_PREFIX}${uri.toString()}`, undefined);
      }
    }
  }

  knownUris(): vscode.Uri[] {
    return Array.from(this.map.keys()).map((s) => vscode.Uri.parse(s));
  }

  private persistOne(uri: vscode.Uri, segments: Segment[] | undefined): void {
    if (!this.memento) return;
    const key = `${KEY_PREFIX}${uri.toString()}`;
    this.memento.update(key, segments).then(
      () => { /* ok */ },
      (err) => this.logger?.(`[segmentStore] WARN persistence failed: ${(err as Error).message}`),
    );
  }

  dispose(): void {
    this.map.clear();
    this._onDidChange.dispose();
  }
}
