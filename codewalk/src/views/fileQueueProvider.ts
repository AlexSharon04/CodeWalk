import * as vscode from "vscode";
import * as path from "node:path";
import type { WalkSession } from "../services/walkSession";

const WORKSPACE_EXCLUDE_GLOB =
  "**/{node_modules,dist,out,build,.git,.next,.turbo,.vercel,.vscode-test,target,coverage,.idea,.pytest_cache,__pycache__}/**";

export class FileQueueProvider implements vscode.TreeDataProvider<FileQueueItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileQueueItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private workspaceFiles: vscode.Uri[] = [];
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly walkSession: WalkSession) {
    this.subs.push(walkSession.onDidChange(() => this._onDidChangeTreeData.fire(undefined)));
    void this.refreshWorkspaceFiles();
  }

  async refreshWorkspaceFiles(): Promise<void> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      this.workspaceFiles = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }
    const found = await vscode.workspace.findFiles("**/*", WORKSPACE_EXCLUDE_GLOB, 500);
    this.workspaceFiles = found.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: FileQueueItem): vscode.TreeItem {
    return element.toTreeItem();
  }

  getChildren(element?: FileQueueItem): FileQueueItem[] {
    if (!element) {
      return this.buildFileItems();
    }
    return [];
  }

  private buildFileItems(): FileQueueItem[] {
    const queueUriSet = new Set(this.walkSession.state().fileQueue.map(u => u.toString()));
    return this.workspaceFiles.map(uri => {
      const checked = queueUriSet.has(uri.toString());
      return new FileQueueItem(uri, checked);
    });
  }

  /** Called by the TreeView's onDidChangeCheckboxState wiring in extension.ts. */
  toggleCheckbox(uri: vscode.Uri, state: vscode.TreeItemCheckboxState): void {
    if (state === vscode.TreeItemCheckboxState.Checked) {
      this.walkSession.addFile(uri);
    } else {
      this.walkSession.removeFile(uri);
    }
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

export class FileQueueItem {
  constructor(
    readonly uri: vscode.Uri,
    readonly checked: boolean,
  ) {}

  toTreeItem(): vscode.TreeItem {
    const wsFolder = vscode.workspace.getWorkspaceFolder(this.uri);
    const relative = wsFolder
      ? path.relative(wsFolder.uri.fsPath, this.uri.fsPath)
      : this.uri.fsPath;
    const item = new vscode.TreeItem(path.basename(this.uri.fsPath), vscode.TreeItemCollapsibleState.None);
    item.description = path.dirname(relative);
    item.resourceUri = this.uri;
    item.checkboxState = this.checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.tooltip = relative;
    item.contextValue = "codewalk.fileQueueItem";
    return item;
  }
}
