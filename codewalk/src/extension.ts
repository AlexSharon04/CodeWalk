import * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
  // Real wiring lands in Task 15.
  console.log("CodeWalk activated (scaffold).");
}

export function deactivate(): void {
  // No-op in scaffold.
}
