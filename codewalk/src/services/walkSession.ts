import * as vscode from "vscode";
import type { SegmentStore } from "../engine/segmentStore";

export interface WalkSessionState {
  readonly fileQueue: readonly vscode.Uri[];
  readonly activeFileIndex: number;   // -1 when not active
  readonly activeBlockIndex: number;  // -1 when no block has been focused yet
}

export interface NavTarget {
  readonly uri: vscode.Uri;
  readonly segmentId: string;
  readonly blockIndex: number;
  readonly fileIndex: number;
}

export class WalkSession implements vscode.Disposable {
  private fileQueue: vscode.Uri[] = [];
  private activeFileIndex = -1;
  private activeBlockIndex = -1;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly segStore: SegmentStore) {}

  isActive(): boolean {
    return this.activeFileIndex >= 0;
  }

  state(): WalkSessionState {
    return {
      fileQueue: [...this.fileQueue],
      activeFileIndex: this.activeFileIndex,
      activeBlockIndex: this.activeBlockIndex,
    };
  }

  activeFile(): vscode.Uri | undefined {
    return this.activeFileIndex >= 0 ? this.fileQueue[this.activeFileIndex] : undefined;
  }

  activeSegmentCount(): number {
    const uri = this.activeFile();
    if (!uri) return 0;
    return this.segStore.get(uri)?.length ?? 0;
  }

  setQueue(uris: readonly vscode.Uri[]): void {
    this.fileQueue = uris.map(u => u);
    this.activeFileIndex = this.fileQueue.length > 0 ? 0 : -1;
    this.activeBlockIndex = -1;
    void this.refreshContextKey();
    this._onDidChange.fire();
  }

  addFile(uri: vscode.Uri): void {
    if (this.fileQueue.some(q => q.toString() === uri.toString())) return;
    this.fileQueue.push(uri);
    if (this.activeFileIndex === -1) this.activeFileIndex = 0;
    void this.refreshContextKey();
    this._onDidChange.fire();
  }

  removeFile(uri: vscode.Uri): void {
    const idx = this.fileQueue.findIndex(q => q.toString() === uri.toString());
    if (idx < 0) return;
    this.fileQueue.splice(idx, 1);
    if (this.fileQueue.length === 0) {
      this.end();
      return;
    }
    if (idx < this.activeFileIndex) {
      this.activeFileIndex--;
    } else if (idx === this.activeFileIndex) {
      // Stayed on the same index; the file at this slot is now whatever shifted in.
      this.activeBlockIndex = -1;
      if (this.activeFileIndex >= this.fileQueue.length) {
        this.activeFileIndex = this.fileQueue.length - 1;
      }
    }
    this._onDidChange.fire();
  }

  start(): void {
    if (this.activeFileIndex < 0 && this.fileQueue.length > 0) {
      this.activeFileIndex = 0;
    }
    void this.refreshContextKey();
    this._onDidChange.fire();
  }

  end(): void {
    this.fileQueue = [];
    this.activeFileIndex = -1;
    this.activeBlockIndex = -1;
    void this.refreshContextKey();
    this._onDidChange.fire();
  }

  /** Called by CommentController when a thread opens for a segment. */
  setActive(uri: vscode.Uri, segmentId: string | undefined): void {
    const fileIdx = this.fileQueue.findIndex(q => q.toString() === uri.toString());
    if (fileIdx < 0) {
      // Click happened on a file not in the queue — auto-add and treat as active.
      this.fileQueue.push(uri);
      this.activeFileIndex = this.fileQueue.length - 1;
    } else {
      this.activeFileIndex = fileIdx;
    }
    this.activeBlockIndex = segmentId ? this.indexOfSegment(uri, segmentId) : -1;
    void this.refreshContextKey();
    this._onDidChange.fire();
  }

  /** Compute the next block target without mutating state. */
  peekNext(): NavTarget | undefined {
    return this.computeStep(+1);
  }

  /** Compute the previous block target without mutating state. */
  peekPrev(): NavTarget | undefined {
    return this.computeStep(-1);
  }

  /** Drop the current file from the queue; return the first block of the next file. */
  skipFile(): NavTarget | undefined {
    const removedIdx = this.activeFileIndex;
    if (removedIdx < 0) return undefined;
    this.fileQueue.splice(removedIdx, 1);
    if (this.fileQueue.length === 0) {
      this.end();
      return undefined;
    }
    if (removedIdx >= this.fileQueue.length) {
      this.activeFileIndex = this.fileQueue.length - 1;
    }
    // activeFileIndex unchanged (next file shifted into this slot) or clamped above.
    this.activeBlockIndex = -1;
    this._onDidChange.fire();
    return this.firstBlockOfActive();
  }

  /** Apply a previously-computed nav target to internal state. */
  applyTarget(target: NavTarget): void {
    this.activeFileIndex = target.fileIndex;
    this.activeBlockIndex = target.blockIndex;
    this._onDidChange.fire();
  }

  dispose(): void {
    void this.refreshContextKey(false);
    this._onDidChange.dispose();
  }

  private indexOfSegment(uri: vscode.Uri, segmentId: string): number {
    const segs = this.segStore.get(uri);
    if (!segs) return -1;
    return segs.findIndex(s => s.id === segmentId);
  }

  private firstBlockOfActive(): NavTarget | undefined {
    const uri = this.activeFile();
    if (!uri) return undefined;
    const segs = this.segStore.get(uri);
    if (!segs || segs.length === 0) {
      // Next file isn't segmented yet — same placeholder shape as computeStep so
      // blockNav can trigger segmentation on demand.
      return { uri, segmentId: "", blockIndex: -1, fileIndex: this.activeFileIndex };
    }
    return { uri, segmentId: segs[0]!.id, blockIndex: 0, fileIndex: this.activeFileIndex };
  }

  private computeStep(direction: 1 | -1): NavTarget | undefined {
    const uri = this.activeFile();
    if (!uri) return undefined;
    const segs = this.segStore.get(uri);
    if (!segs || segs.length === 0) return undefined;

    // If no block focused yet, step from -1 → 0 forward, or last → last back.
    let nextBlockIdx = this.activeBlockIndex + direction;
    if (this.activeBlockIndex === -1) {
      nextBlockIdx = direction > 0 ? 0 : segs.length - 1;
    }

    if (nextBlockIdx >= 0 && nextBlockIdx < segs.length) {
      return {
        uri,
        segmentId: segs[nextBlockIdx]!.id,
        blockIndex: nextBlockIdx,
        fileIndex: this.activeFileIndex,
      };
    }

    // Crossed the file boundary — try the next/prev file in the queue.
    const nextFileIdx = this.activeFileIndex + direction;
    if (nextFileIdx < 0 || nextFileIdx >= this.fileQueue.length) return undefined;
    const nextUri = this.fileQueue[nextFileIdx]!;
    const nextSegs = this.segStore.get(nextUri);
    if (!nextSegs || nextSegs.length === 0) {
      // The next file isn't segmented yet — caller (command handler) needs to trigger
      // segmentation and re-issue. Surfaced as a placeholder target with the URI but no
      // segmentId; commands check for this and act accordingly.
      return { uri: nextUri, segmentId: "", blockIndex: -1, fileIndex: nextFileIdx };
    }
    const nextBlock = direction > 0 ? 0 : nextSegs.length - 1;
    return {
      uri: nextUri,
      segmentId: nextSegs[nextBlock]!.id,
      blockIndex: nextBlock,
      fileIndex: nextFileIdx,
    };
  }

  private async refreshContextKey(value?: boolean): Promise<void> {
    const next = value ?? this.isActive();
    try {
      await vscode.commands.executeCommand("setContext", "codewalk.active", next);
    } catch {
      // setContext can fail in unit-test contexts that don't have the command registered;
      // that's fine — production callsites are inside an activated extension.
    }
  }
}
