import * as vscode from "vscode";
import * as path from "node:path";
import type { SegmentStore } from "../engine/segmentStore";
import type { WalkSession, NavTarget } from "../services/walkSession";
import type { Segment } from "../types";

export function registerBlockNavCommands(
  walkSession: WalkSession,
  segStore: SegmentStore,
): vscode.Disposable[] {
  const next = vscode.commands.registerCommand("codewalk.nextBlock", async () => {
    const target = walkSession.peekNext();
    if (!target) {
      vscode.window.showInformationMessage("CodeWalk: end of walkthrough.");
      return;
    }
    await navigateTo(walkSession, segStore, target);
  });

  const prev = vscode.commands.registerCommand("codewalk.prevBlock", async () => {
    const target = walkSession.peekPrev();
    if (!target) {
      vscode.window.showInformationMessage("CodeWalk: at the first block.");
      return;
    }
    await navigateTo(walkSession, segStore, target);
  });

  const skip = vscode.commands.registerCommand("codewalk.skipFile", async () => {
    const target = walkSession.skipFile();
    if (!target) {
      vscode.window.showInformationMessage("CodeWalk: walkthrough complete.");
      return;
    }
    await navigateTo(walkSession, segStore, target);
  });

  return [next, prev, skip];
}

async function navigateTo(
  walkSession: WalkSession,
  segStore: SegmentStore,
  target: NavTarget,
): Promise<void> {
  // Placeholder target — next file isn't segmented yet. Surfaced as a hint until
  // step 11 wires on-demand segmentation.
  if (target.segmentId === "") {
    vscode.window.showInformationMessage(
      `CodeWalk: ${path.basename(target.uri.fsPath)} hasn't been analyzed yet — run Start CodeWalk on it first.`,
    );
    return;
  }

  walkSession.applyTarget(target);

  const doc = await vscode.workspace.openTextDocument(target.uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });

  const segs = segStore.get(target.uri);
  const segment: Segment | undefined = segs?.find(s => s.id === target.segmentId);
  if (segment) {
    const range = new vscode.Range(
      segment.startLine - 1, 0,
      segment.endLine - 1, 0,
    );
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(range.start, range.start);
  }

  await vscode.commands.executeCommand("codewalk.expandBlock", target.segmentId);
}
