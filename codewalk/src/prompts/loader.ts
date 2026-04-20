import * as fs from "node:fs";
import * as path from "node:path";

const cache = new Map<string, string>();

export function loadPrompt(
  name: string,
  vars: Record<string, string>,
  promptsDir: string,
): string {
  const cacheKey = `${promptsDir}::${name}`;
  let template = cache.get(cacheKey);
  if (template === undefined) {
    const filePath = path.join(promptsDir, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    template = fs.readFileSync(filePath, "utf-8");
    cache.set(cacheKey, template);
  }

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(value);
  }

  const remaining = result.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    throw new Error(`Prompt has unsubstituted placeholders: ${remaining.join(", ")}`);
  }
  return result;
}

export function clearPromptCache(): void {
  cache.clear();
}
