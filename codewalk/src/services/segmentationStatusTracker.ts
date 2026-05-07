import * as vscode from "vscode";

/**
 * Tracks which file URIs are currently being segmented. Used by the sidebar
 * tree to render a spinner on rows whose segmentation is in flight.
 *
 * The store of "is segmented" lives in SegmentStore — this tracker only
 * answers "is it being computed right now."
 */
export class SegmentationStatusTracker implements vscode.Disposable {
  private readonly inFlight = new Set<string>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  begin(uri: vscode.Uri): void {
    this.inFlight.add(uri.toString());
    this._onDidChange.fire();
  }

  end(uri: vscode.Uri): void {
    if (this.inFlight.delete(uri.toString())) {
      this._onDidChange.fire();
    }
  }

  isInFlight(uri: vscode.Uri): boolean {
    return this.inFlight.has(uri.toString());
  }

  dispose(): void {
    this.inFlight.clear();
    this._onDidChange.dispose();
  }
}
