import * as vscode from "vscode";
import {
  resolveBackend,
  type BackendKey,
  type ResolvedBackend,
} from "../llm/presets";

interface BackendOption extends vscode.QuickPickItem {
  backend: BackendKey;
}

const BACKEND_OPTIONS: BackendOption[] = [
  {
    label: "Groq",
    description: "Free cloud inference",
    detail: "Fast, generous free tier. Good for most laptops. Requires a free account at groq.com.",
    backend: "groq",
  },
  {
    label: "Ollama (local)",
    description: "Private, offline, free",
    detail: "Runs the model on your machine. Best with a dedicated GPU. Requires installing Ollama separately.",
    backend: "ollama-local",
  },
  {
    label: "OpenRouter",
    description: "200+ models including Claude, GPT, Llama",
    detail: "Pay-as-you-go. One account for many providers.",
    backend: "openrouter",
  },
  {
    label: "Anthropic Claude",
    description: "Highest-quality reasoning",
    detail: "Claude Sonnet 4.6 by default. Paid API.",
    backend: "anthropic-oai",
  },
  {
    label: "OpenAI",
    description: "GPT-4o-mini and family",
    detail: "OpenAI's hosted API. Paid.",
    backend: "openai",
  },
  {
    label: "Together AI",
    description: "Open-source model hosting",
    detail: "Llama, Qwen, and more. Paid.",
    backend: "together",
  },
  {
    label: "Custom",
    description: "Any OpenAI-compatible endpoint",
    detail: "Advanced: you provide the baseUrl, apiKey, and model.",
    backend: "custom",
  },
];

const API_KEY_URLS: Partial<Record<BackendKey, string>> = {
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/keys",
  "anthropic-oai": "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  together: "https://api.together.xyz/settings/api-keys",
};

export async function runFirstRunWizard(): Promise<ResolvedBackend | undefined> {
  const selected = await vscode.window.showQuickPick(BACKEND_OPTIONS, {
    title: "CodeWalk — Choose an LLM Backend",
    placeHolder: "Which AI should analyze your code?",
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return undefined;

  let baseUrl = "";
  if (selected.backend === "custom") {
    const input = await vscode.window.showInputBox({
      title: "CodeWalk — Custom Backend URL",
      prompt: "OpenAI-compatible endpoint (e.g. https://api.example.com/v1)",
      placeHolder: "https://api.example.com/v1",
      ignoreFocusOut: true,
    });
    if (!input) return undefined;
    baseUrl = input.trim();
  }

  let apiKey = "";
  if (selected.backend !== "ollama-local") {
    const keyUrl = API_KEY_URLS[selected.backend];
    const prompt = keyUrl
      ? `Paste your ${selected.label} API key. Get one at ${keyUrl}`
      : `Paste your ${selected.label} API key`;
    const input = await vscode.window.showInputBox({
      title: `CodeWalk — ${selected.label} API Key`,
      prompt,
      placeHolder: "API key (hidden as you type)",
      password: true,
      ignoreFocusOut: true,
    });
    if (!input) return undefined;
    apiKey = input.trim();
  }

  const cfg = vscode.workspace.getConfiguration("codewalk");
  await cfg.update("backend", selected.backend, vscode.ConfigurationTarget.Global);
  await cfg.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
  await cfg.update("baseUrl", baseUrl, vscode.ConfigurationTarget.Global);
  // Clear any stale model override so the new preset's default applies.
  await cfg.update("model", "", vscode.ConfigurationTarget.Global);

  return resolveBackend({
    backend: selected.backend,
    apiKey,
    model: "",
    baseUrl,
  });
}
