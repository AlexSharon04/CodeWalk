# CodeWalk

AI-guided walkthroughs of unfamiliar codebases, block by block. VS Code extension for COS 497 (AI Agents, Spring 2026).

This document is the **developer workflow guide** — how to set up, run, test, and iterate on the extension. The end-user README lives at [`codewalk/README.md`](./codewalk/README.md) and ships inside the packaged `.vsix`.

For project state and planning see [`docs/PROJECT_STATE.md`](./docs/PROJECT_STATE.md). For architectural decisions that deviate from the original design doc, see [`docs/ARCHITECTURE_DECISIONS.md`](./docs/ARCHITECTURE_DECISIONS.md).

---

## One-time setup

You need **Node.js 20 or newer** (for built-in `fetch` and ES2022 features).

```bash
cd codewalk
npm install
```

That pulls ~355 dev dependencies (esbuild, typescript, mocha, @vscode/test-cli). It takes ~30–60 seconds on a decent connection.

The first time you run the test suite, `@vscode/test-cli` also downloads a fresh copy of VS Code (~100 MB) into `codewalk/.vscode-test/` — that's a one-time cost, already gitignored.

---

## Daily development loop

### Step 1 — Open the right folder in VS Code

**Open the `codewalk/` subfolder, NOT the repo root.** VS Code's extension development tooling (F5, launch.json, task runner, etc.) looks for `package.json` in the workspace root — if you open `CodeWalk/`, it won't find one; if you open `CodeWalk/codewalk/`, everything works.

Two ways:

- **From inside VS Code:** `File → Open Folder…` → navigate to `C:\Users\alexs\Documents\Code\CodeWalk\codewalk` → click Select Folder.
- **From the terminal:**
  ```bash
  code "C:\Users\alexs\Documents\Code\CodeWalk\codewalk"
  ```

You can also open *both* folders at once using a multi-root workspace (one for docs, one for extension), but simpler is fine for now.

### Step 2 — Launch the Extension Development Host

This opens a **second VS Code window** with CodeWalk loaded as an extension. Any of these work — pick whichever fits your keyboard:

| Method | How | When to use |
|---|---|---|
| **F5** | Just press `F5`. If your laptop maps F-keys to media controls by default, press `Fn+F5` instead. | Fastest if your keyboard plays nice. |
| **Menu** | `Run → Start Debugging` (top menu bar). | No keyboard gymnastics required. |
| **Command palette** | `Ctrl+Shift+P` → type `Debug: Start Debugging` → Enter. | Works without any F-key. |
| **Sidebar button** | Click the Run and Debug icon (triangle-with-bug) on the left sidebar → click the green ▷ "Run Extension" button at the top. | Most visual; great for first-time. |

All four trigger the same config in [`codewalk/.vscode/launch.json`](./codewalk/.vscode/launch.json), which runs `npm run build` first (via the `tasks.json` default build task) and then spawns the Extension Development Host.

**You'll know it worked when:** a new VS Code window opens with `[Extension Development Host]` in its title bar.

### Step 3 — Use the extension

In the Extension Development Host window:

1. Open any code file (`.ts`, `.py`, `.js`, `.rs` — anything non-empty).
2. Open the command palette: `Ctrl+Shift+P`.
3. Type `CodeWalk: Start Walkthrough` and press Enter.

**First time (or whenever `codewalk.apiKey` is empty)** you'll see the first-run wizard:

1. A dropdown picker with 7 LLM backend options. Pick **Groq** for the fastest setup (free API key at https://console.groq.com/keys).
2. A password-masked input box. Paste your API key and press Enter.
3. Segmentation runs immediately — no re-invocation needed.

**Subsequent runs** skip the wizard (your settings are saved globally) and go straight to segmentation.

When segmentation finishes, you'll see:

- `▶ Block Name — one-liner` labels above each logical code block (VS Code CodeLens).
- Subtle background tints on each block, color-coded by difficulty (gray / blue / orange / red).

Clicking a label does nothing yet — expansion panels arrive in Phase 2.

### Step 4 — Iterate (when you change source code)

After editing `codewalk/src/**/*.ts`:

1. Save the file (`Ctrl+S`).
2. Switch to the Extension Development Host window.
3. Press `Ctrl+R` — this reloads the extension host with the new code.

You do NOT need to close/reopen the window or re-launch via F5. `Ctrl+R` is the fast iteration loop.

**If `Ctrl+R` doesn't pick up your changes:** the build may not have run. Check the build output by looking at `codewalk/dist/extension.js`'s modification timestamp. If it's stale, run `npm run build` manually in a terminal and then `Ctrl+R` again.

---

## Common commands (run from `codewalk/` directory)

| Command | What it does | How long |
|---|---|---|
| `npm run build` | Bundles source to `dist/extension.js` via esbuild. | ~1 s |
| `npm run watch` | Builds continuously on every source change. Useful for iteration. | runs until you Ctrl+C |
| `npm test` | Compiles TypeScript, bundles, launches a throwaway VS Code, runs 41 unit tests + 1 skipped integration test. | ~30 s first run, ~10 s thereafter |
| `npm run package` | Produces `codewalk-0.1.0.vsix` for distribution. | ~3 s |
| `INTEGRATION_TESTS=1 npm test` | Runs the Ollama integration test too (requires Ollama running locally). | +60–120 s |

---

## Installing the `.vsix` into your main VS Code

Once you've packaged the extension (`npm run package`), you can install it into your everyday VS Code window instead of using the Dev Host:

```bash
code --install-extension "C:\Users\alexs\Documents\Code\CodeWalk\codewalk\codewalk-0.1.0.vsix"
```

Restart VS Code after install. Uninstall with:

```bash
code --uninstall-extension codewalk-dev.codewalk
```

**Be aware:** the installed extension uses your global `codewalk.apiKey` setting, not the Dev Host's. If you test with the Dev Host and then install the `.vsix`, your main VS Code will have its *own* codewalk settings (possibly empty), and the wizard will pop up again on first use.

---

## Troubleshooting

### "F5 does nothing" / "asks me to select an environment"

- Make sure you opened `codewalk/` — NOT the repo root `CodeWalk/`.
- Check that `.vscode/launch.json` exists inside `codewalk/`. If it doesn't, pull the latest from git.
- Your F-keys may be mapped to media controls. Try `Fn+F5`, or use `Run → Start Debugging` from the menu.

### "Command `CodeWalk: Start Walkthrough` not found"

- Make sure you're running the command in the **Extension Development Host** window (the one with `[Extension Development Host]` in the title), not the main VS Code window that you opened `codewalk/` in.
- If the extension host just launched, give it ~2 seconds to finish activating — VS Code activates extensions asynchronously.
- Check the Extension Dev Host's Output panel (`View → Output → CodeWalk` dropdown) for activation errors.

### "The wizard doesn't appear — it just silently does nothing"

- Check `Ctrl+,` (Settings) → search `codewalk` → is `Codewalk: Api Key` already set? The wizard only appears when the key is empty and the backend isn't reachable.
- To force the wizard to re-trigger: delete the value in `Codewalk: Api Key`, close the Settings tab, and re-run the command.

### "Changes to source don't show up"

- Did you save the file? `Ctrl+S`.
- Did you reload the Extension Dev Host? `Ctrl+R` inside the dev-host window.
- Is `npm run build` picking up your change? Check `codewalk/dist/extension.js` modification time.
- If you edited a test file, that won't change the dev host — tests run in a different process. Run `npm test` from the terminal.

### "I see a 'bash.exe.stackdump' file at the repo root"

Windows Git Bash crash artifact, harmless. Safe to delete. It's already untracked (not in git) so you can ignore it.

### "ExtensionDevelopmentPath reports an error about package.json"

You opened the wrong folder. Close and re-open `codewalk/`, not `CodeWalk/`.

---

## Project layout quick-reference

```
CodeWalk/                                 ← repo root (this file lives here)
├── README.md                             ← you are here (developer guide)
├── CLAUDE.md                             ← session primer for Claude Code
├── CodeWalk-design-doc.md                ← original master spec
├── codewalk/                             ← the extension itself
│   ├── README.md                         ← end-user README (shipped in .vsix)
│   ├── package.json                      ← extension manifest + deps
│   ├── src/                              ← TypeScript source
│   ├── test/                             ← Mocha unit + integration tests
│   ├── prompts/                          ← LLM prompt templates (markdown)
│   ├── dist/                             ← esbuild output (gitignored)
│   └── .vscode/                          ← launch.json + tasks.json for F5
└── docs/
    ├── PROJECT_STATE.md                  ← current phase / step / open questions
    ├── IMPLEMENTATION_PLAN.md            ← 4-phase roadmap
    ├── ARCHITECTURE_DECISIONS.md         ← ADRs that supersede the design doc
    └── superpowers/
        ├── specs/                        ← per-phase design specs
        └── plans/                        ← per-phase implementation plans
```
