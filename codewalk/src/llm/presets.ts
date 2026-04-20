export type BackendKey =
  | "ollama-local"
  | "openrouter"
  | "groq"
  | "openai"
  | "anthropic-oai"
  | "together"
  | "custom";

export type StructuredOutputMode = "json_object" | "json_schema";

export interface PresetConfig {
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  // Anthropic's OAI-compat requires json_schema; Groq's default llama-3.3 rejects it.
  // Everyone else accepts both — we pick json_object for broad compat.
  structuredOutputMode: StructuredOutputMode;
}

const PRESETS: Record<Exclude<BackendKey, "custom">, PresetConfig> = {
  "ollama-local":  { baseUrl: "http://localhost:11434/v1",      defaultModel: "qwen2.5-coder:7b",                        requiresApiKey: false, structuredOutputMode: "json_object" },
  "openrouter":    { baseUrl: "https://openrouter.ai/api/v1",   defaultModel: "meta-llama/llama-3.3-70b-instruct",       requiresApiKey: true,  structuredOutputMode: "json_object" },
  "groq":          { baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile",                 requiresApiKey: true,  structuredOutputMode: "json_object" },
  "openai":        { baseUrl: "https://api.openai.com/v1",      defaultModel: "gpt-4o-mini",                             requiresApiKey: true,  structuredOutputMode: "json_object" },
  "anthropic-oai": { baseUrl: "https://api.anthropic.com/v1",   defaultModel: "claude-sonnet-4-6",                       requiresApiKey: true,  structuredOutputMode: "json_schema" },
  "together":      { baseUrl: "https://api.together.xyz/v1",    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", requiresApiKey: true,  structuredOutputMode: "json_object" },
};

export interface UserConfig {
  backend: BackendKey;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ResolvedBackend {
  backend: BackendKey;
  baseUrl: string;
  apiKey: string;
  model: string;
  requiresApiKey: boolean;
  structuredOutputMode: StructuredOutputMode;
}

export function resolveBackend(cfg: UserConfig): ResolvedBackend {
  if (cfg.backend === "custom") {
    if (!cfg.baseUrl) {
      throw new Error("Custom backend requires codewalk.baseUrl to be set");
    }
    return {
      backend: "custom",
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model || "",
      requiresApiKey: false,
      structuredOutputMode: "json_object",
    };
  }
  const preset = PRESETS[cfg.backend];
  return {
    backend: cfg.backend,
    baseUrl: cfg.baseUrl || preset.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model || preset.defaultModel,
    requiresApiKey: preset.requiresApiKey,
    structuredOutputMode: preset.structuredOutputMode,
  };
}
