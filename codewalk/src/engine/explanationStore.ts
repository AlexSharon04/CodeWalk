import * as vscode from "vscode";
import type { Explanation } from "../types";
import { EXPLANATION_PROMPT_VERSION } from "./explanationAgent";

const KEY_PREFIX = "explanation:";

function keyFor(preset: string, promptVersion: string, segmentId: string): string {
  return `${KEY_PREFIX}${preset}:${promptVersion}:${segmentId}`;
}

function isDoneExplanation(x: unknown): x is Explanation {
  if (!x || typeof x !== "object") return false;
  const o = x as Explanation;
  return (
    typeof o.segmentId === "string"
    && typeof o.summary === "string"
    && o.renderState === "done"
  );
}

export class ExplanationStore implements vscode.Disposable {
  private readonly mem = new Map<string, Explanation>();
  private readonly _onDidChange = new vscode.EventEmitter<string>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger?: (msg: string) => void,
    private readonly currentPromptVersion: string = EXPLANATION_PROMPT_VERSION,
  ) {
    this.rehydrate();
  }

  private rehydrate(): void {
    const state = this.context.globalState;
    for (const key of state.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const parts = key.slice(KEY_PREFIX.length).split(":");
      if (parts.length < 3) {
        this.logger?.(`[explanationStore] WARN dropping malformed key ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const [, promptVersion] = parts;
      if (promptVersion !== this.currentPromptVersion) {
        this.logger?.(`[explanationStore] dropping stale-version entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      const value = state.get<unknown>(key);
      if (!isDoneExplanation(value)) {
        this.logger?.(`[explanationStore] WARN dropping malformed entry ${key}`);
        void state.update(key, undefined);
        continue;
      }
      this.mem.set(key, value);
    }
  }

  get(segmentId: string, preset: string, promptVersion: string): Explanation | undefined {
    return this.mem.get(keyFor(preset, promptVersion, segmentId));
  }

  set(
    segmentId: string,
    preset: string,
    promptVersion: string,
    exp: Explanation,
  ): void {
    const key = keyFor(preset, promptVersion, segmentId);
    this.mem.set(key, exp);
    this._onDidChange.fire(segmentId);
    if (exp.renderState === "done") {
      this.context.globalState.update(key, exp).then(
        () => { /* ok */ },
        (err) => this.logger?.(`[explanationStore] WARN persistence failed: ${(err as Error).message}`),
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
