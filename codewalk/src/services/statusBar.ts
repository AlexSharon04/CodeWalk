import * as vscode from "vscode";
import * as path from "node:path";
import type { SegmentStore } from "../engine/segmentStore";
import type { WalkSession } from "./walkSession";

export class CodeWalkStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly walkSession: WalkSession,
    private readonly segStore: SegmentStore,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "codewalk.showBlockQuickPick";
    this.subs.push(walkSession.onDidChange(() => this.refresh()));
    this.subs.push(segStore.onDidChange(() => this.refresh()));
    this.subs.push(
      vscode.commands.registerCommand("codewalk.showBlockQuickPick", () => this.showQuickPick()),
    );
    this.refresh();
  }

  private refresh(): void {
    if (!this.walkSession.isActive()) {
      this.item.hide();
      return;
    }
    const state = this.walkSession.state();
    const fileNum = state.activeFileIndex + 1;
    const fileTotal = state.fileQueue.length;
    const blockTotal = this.walkSession.activeSegmentCount();
    const blockNumStr = state.activeBlockIndex >= 0 ? String(state.activeBlockIndex + 1) : "—";
    const blockTotalStr = blockTotal > 0 ? String(blockTotal) : "—";
    this.item.text = `$(book) CodeWalk: File ${fileNum}/${fileTotal} | Block ${blockNumStr}/${blockTotalStr}`;
    this.item.tooltip = "Click to jump to a block";
    this.item.show();
  }

  private async showQuickPick(): Promise<void> {
    const uri = this.walkSession.activeFile();
    if (!uri) return;
    const segs = this.segStore.get(uri);
    if (!segs || segs.length === 0) {
      vscode.window.showInformationMessage("CodeWalk: this file has no analyzed blocks yet.");
      return;
    }
    const items: Array<vscode.QuickPickItem & { segmentId: string }> = segs.map((s, i) => ({
      label: `${i + 1}. ${s.label}`,
      description: s.oneLiner,
      detail: `lines ${s.startLine}-${s.endLine} · ${s.difficulty}`,
      segmentId: s.id,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${path.basename(uri.fsPath)} — pick a block to jump to`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    const idx = segs.findIndex(s => s.id === picked.segmentId);
    if (idx < 0) return;
    this.walkSession.applyTarget({
      uri,
      segmentId: picked.segmentId,
      blockIndex: idx,
      fileIndex: this.walkSession.state().activeFileIndex,
    });
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const seg = segs[idx]!;
    const range = new vscode.Range(seg.startLine - 1, 0, seg.endLine - 1, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(range.start, range.start);
    await vscode.commands.executeCommand("codewalk.expandBlock", picked.segmentId);
  }

  dispose(): void {
    this.item.dispose();
    for (const s of this.subs) s.dispose();
  }
}
