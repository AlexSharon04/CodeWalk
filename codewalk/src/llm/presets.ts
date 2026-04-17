export type BackendKey =
  | "ollama-local"
  | "openrouter"
  | "groq"
  | "openai"
  | "anthropic-oai"
  | "together"
  | "custom";

export interface PresetConfig {
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}

const PRESETS: Record<Exclude<BackendKey, "custom">, PresetConfig> = {
  "ollama-local":  { baseUrl: "http://localhost:11434/v1",      defaultModel: "qwen2.5-coder:7b",                        requiresApiKey: false },
  "openrouter":    { baseUrl: "https://openrouter.ai/api/v1",   defaultModel: "meta-llama/llama-3.3-70b-instruct",       requiresApiKey: true  },
  "groq":          { baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile",                 requiresApiKey: true  },
  "openai":        { baseUrl: "https://api.openai.com/v1",      defaultModel: "gpt-4o-mini",                             requiresApiKey: true  },
  "anthropic-oai": { baseUrl: "https://api.anthropic.com/v1",   defaultModel: "claude-sonnet-4-6",                       requiresApiKey: true  },
  "together":      { baseUrl: "https://api.together.xyz/v1",    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", requiresApiKey: true  },
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
    };
  }
  const preset = PRESETS[cfg.backend];
  return {
    backend: cfg.backend,
    baseUrl: cfg.baseUrl || preset.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model || preset.defaultModel,
    requiresApiKey: preset.requiresApiKey,
  };
}
