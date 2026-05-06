import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";
import type { WalkSession, NavTarget } from "../services/walkSession";
import type { Segment } from "../types";
import { segmentFileForWalk } from "./segmentFile";

export function registerBlockNavCommands(
  context: vscode.ExtensionContext,
  walkSession: WalkSession,
  segStore: SegmentStore,
  output: vscode.OutputChannel,
): vscode.Disposable[] {
  const next = vscode.commands.registerCommand("codewalk.nextBlock", async () => {
    const target = walkSession.peekNext();
    if (!target) {
      vscode.window.showInformationMessage("CodeWalk: end of walkthrough.");
      return;
    }
    await navigateTo(context, walkSession, segStore, output, target, +1);
  });

  const prev = vscode.commands.registerCommand("codewalk.prevBlock", async () => {
    const target = walkSession.peekPrev();
    if (!target) {
      vscode.window.showInformationMessage("CodeWalk: at the first block.");
      return;
    }
    await navigateTo(context, walkSession, segStore, output, target, -1);
  });

  const skip = vscode.commands.registerCommand("codewalk.skipFile", async () => {
    const queueSizeBefore = walkSession.state().fileQueue.length;
    const target = walkSession.skipFile();
    if (!target) {
      const message = queueSizeBefore <= 1
        ? "CodeWalk: only file in the queue. Add more files in the CodeWalk sidebar to walk multiple files."
        : "CodeWalk: walkthrough complete.";
      vscode.window.showInformationMessage(message);
      return;
    }
    await navigateTo(context, walkSession, segStore, output, target, +1);
  });

  return [next, prev, skip];
}

async function navigateTo(
  context: vscode.ExtensionContext,
  walkSession: WalkSession,
  segStore: SegmentStore,
  output: vscode.OutputChannel,
  target: NavTarget,
  direction: 1 | -1,
): Promise<void> {
  // Placeholder target — next file isn't segmented yet. Trigger segmentation
  // on-demand, then re-issue the original direction's peek so we land on the
  // right block (first or last) of the newly-segmented file.
  if (target.segmentId === "") {
    walkSession.applyTarget(target);
    const result = await segmentFileForWalk(context, segStore, output, target.uri);
    if (!result.ok || result.segmentCount === 0) return;
    const segs = segStore.get(target.uri);
    if (!segs || segs.length === 0) return;
    const blockIndex = direction > 0 ? 0 : segs.length - 1;
    const resolved: NavTarget = {
      uri: target.uri,
      segmentId: segs[blockIndex]!.id,
      blockIndex,
      fileIndex: target.fileIndex,
    };
    await navigateTo(context, walkSession, segStore, output, resolved, direction);
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
