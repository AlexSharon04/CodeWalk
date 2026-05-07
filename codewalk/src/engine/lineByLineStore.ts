import * as vscode from "vscode";
import type { LineByLine, LineAnnotation } from "../types";
import { LINE_BY_LINE_PROMPT_VERSION } from "./lineByLineAgent";

const KEY_PREFIX = "lineByLine:";

function keyFor(preset: string, promptVersion: string, segmentId: string): string {
  return `${KEY_PREFIX}${preset}:${promptVersion}:${segmentId}`;
}

function isAnnotation(x: unknown): x is LineAnnotation {
  if (!x || typeof x !== "object") return false;
  const o = x as LineAnnotation;
  return (
    typeof o.line === "number"
    && Number.isInteger(o.line)
    && typeof o.short === "string"
    && typeof o.full === "string"
  );
}

function isLineByLine(x: unknown): x is LineByLine {
  if (!x || typeof x !== "object") return false;
  const o = x as LineByLine;
  return (
    typeof o.segmentId === "string"
    && Array.isArray(o.annotations)
    && o.annotations.every(isAnnotation)
    && o.renderState === "done"
  );
}

export class LineByLineStore implements vscode.Disposable {
  private readonly mem = new Map<string, LineByLine>();
  private readonly _onDidChange = new vscode.EventEmitter<string>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger?: (msg: string) => void,
    private readonly currentPromptVersion: string = LINE_BY_LINE_PROMPT_VERSION,
  ) {
    this.rehydrate();
  }

  private rehydrate(): void {
    const state = this.context.globalState;
    for (const key of state.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const parts = key.slice(KEY_PREFIX.length).split(":");
      if (parts.length < 3) {
        this.logger?.(`[lineByLineStore] WARN dropping malformed key ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const [, promptVersion] = parts;
      if (promptVersion !== this.currentPromptVersion) {
        this.logger?.(`[lineByLineStore] dropping stale-version entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const value = state.get<unknown>(key);
      if (!isLineByLine(value)) {
        this.logger?.(`[lineByLineStore] WARN dropping malformed entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      this.mem.set(key, value);
    }
  }

  get(segmentId: string, preset: string, promptVersion: string): LineByLine | undefined {
    return this.mem.get(keyFor(preset, promptVersion, segmentId));
  }

  set(
    segmentId: string,
    preset: string,
    promptVersion: string,
    value: LineByLine,
  ): void {
    const key = keyFor(preset, promptVersion, segmentId);
    this.mem.set(key, value);
    this._onDidChange.fire(segmentId);
    if (value.renderState === "done") {
      this.context.globalState.update(key, value).then(
        () => { /* ok */ },
        (err) => this.logger?.(`[lineByLineStore] WARN persistence failed: ${(err as Error).message}`),
      );
    }
  }

  clear(): void {
    const keys = Array.from(this.mem.keys());
    this.mem.clear();
    for (const key of keys) {
      void this.context.globalState.update(key, undefined);
      const id = key.split(":").pop()!;
      this._onDidChange.fire(id);
    }
  }

  dispose(): void {
    this.mem.clear();
    this._onDidChange.dispose();
  }
}
