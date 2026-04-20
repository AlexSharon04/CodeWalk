import * as vscode from "vscode";

const API_KEY_SECRET = "codewalk.apiKey";
const LEGACY_MIGRATED_FLAG = "codewalk.apiKeyMigrated";

export async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get(API_KEY_SECRET)) ?? "";
}

export async function setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  if (key.length === 0) {
    await context.secrets.delete(API_KEY_SECRET);
  } else {
    await context.secrets.store(API_KEY_SECRET, key);
  }
}

// One-shot migration: move a plaintext codewalk.apiKey from settings.json into SecretStorage
// and blank the setting so it stops syncing via Settings Sync.
export async function migrateLegacyApiKey(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(LEGACY_MIGRATED_FLAG)) return;

  const cfg = vscode.workspace.getConfiguration("codewalk");
  const legacy = cfg.get<string>("apiKey", "");
  if (legacy.length > 0) {
    const existing = await context.secrets.get(API_KEY_SECRET);
    if (!existing) {
      await context.secrets.store(API_KEY_SECRET, legacy);
    }
    // Clear any scope that might hold it. Unknown schema keys are tolerated by .update(undefined).
    await cfg.update("apiKey", undefined, vscode.ConfigurationTarget.Global);
    await cfg.update("apiKey", undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update("apiKey", undefined, vscode.ConfigurationTarget.WorkspaceFolder).then(
      () => undefined,
      () => undefined,
    );
  }

  await context.globalState.update(LEGACY_MIGRATED_FLAG, true);
}
