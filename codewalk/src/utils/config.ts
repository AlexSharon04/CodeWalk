import * as vscode from "vscode";
import type { BackendKey, UserConfig } from "../llm/presets";

export function readUserConfig(): UserConfig {
  const c = vscode.workspace.getConfiguration("codewalk");
  return {
    backend: c.get<BackendKey>("backend", "ollama-local"),
    apiKey: c.get<string>("apiKey", ""),
    model: c.get<string>("model", ""),
    baseUrl: c.get<string>("baseUrl", ""),
  };
}

export function isBlockHighlightsEnabled(): boolean {
  return vscode.workspace.getConfiguration("codewalk").get<boolean>("showBlockHighlights", true);
}
