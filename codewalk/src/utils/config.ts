import * as vscode from "vscode";
import type { BackendKey, UserConfig } from "../llm/presets";
import { getApiKey } from "./secrets";

export async function readUserConfig(context: vscode.ExtensionContext): Promise<UserConfig> {
  const c = vscode.workspace.getConfiguration("codewalk");
  return {
    backend: c.get<BackendKey>("backend", "ollama-local"),
    apiKey: await getApiKey(context),
    model: c.get<string>("model", ""),
    baseUrl: c.get<string>("baseUrl", ""),
  };
}

export function isBlockHighlightsEnabled(): boolean {
  return vscode.workspace.getConfiguration("codewalk").get<boolean>("showBlockHighlights", true);
}
