import * as vscode from "vscode";
import * as path from "node:path";
import type { WalkSession } from "../services/walkSession";
import type { SegmentStore } from "../engine/segmentStore";
import type { SegmentationStatusTracker } from "../services/segmentationStatusTracker";

const WORKSPACE_EXCLUDE_GLOB =
  "**/{node_modules,dist,out,build,.git,.next,.turbo,.vercel,.vscode-test,target,coverage,.idea,.pytest_cache,__pycache__}/**";

type SegmentationStatus = "segmented" | "in-flight" | "pending";

export class FileQueueProvider implements vscode.TreeDataProvider<FileQueueItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileQueueItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private workspaceFiles: vscode.Uri[] = [];
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly walkSession: WalkSession,
    private readonly segStore: SegmentStore,
    private readonly statusTracker: SegmentationStatusTracker,
  ) {
    this.subs.push(walkSession.onDidChange(() => this._onDidChangeTreeData.fire(undefined)));
    this.subs.push(segStore.onDidChange(() => this._onDidChangeTreeData.fire(undefined)));
    this.subs.push(statusTracker.onDidChange(() => this._onDidChangeTreeData.fire(undefined)));
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
      const status = this.statusFor(uri);
      return new FileQueueItem(uri, checked, status);
    });
  }

  private statusFor(uri: vscode.Uri): SegmentationStatus {
    if (this.statusTracker.isInFlight(uri)) return "in-flight";
    if ((this.segStore.get(uri)?.length ?? 0) > 0) return "segmented";
    return "pending";
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
    readonly status: SegmentationStatus = "pending",
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
    item.tooltip = `${relative} — ${tooltipFor(this.status)}`;
    item.iconPath = iconFor(this.status);
    item.contextValue = "codewalk.fileQueueItem";
    return item;
  }
}

function iconFor(status: SegmentationStatus): vscode.ThemeIcon {
  switch (status) {
    case "in-flight": return new vscode.ThemeIcon("loading~spin");
    case "segmented": return new vscode.ThemeIcon("check");
    case "pending":   return new vscode.ThemeIcon("circle-outline");
  }
}

function tooltipFor(status: SegmentationStatus): string {
  switch (status) {
    case "in-flight": return "Segmenting…";
    case "segmented": return "Segmented — ready to walk";
    case "pending":   return "Queued — segments on demand or via background pre-segmentation";
  }
}
