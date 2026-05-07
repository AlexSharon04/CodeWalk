# CodeWalk — AI Code Walkthrough Agent

## VS Code Extension Design Document

**Author:** Alex  
**Course:** COS 497 — AI Agents (Spring 2026)  
**Status:** Draft  
**Last Updated:** April 2026

---

## 1. Vision

CodeWalk is a VS Code extension that transforms unfamiliar codebases into guided, interactive walkthroughs. Unlike code review tools that flag issues, CodeWalk focuses on **human understanding** — breaking code into logical segments and explaining each one at the depth the user needs.

The core UX pattern is **progressive disclosure**:

- **Level 0 — Block Label:** A short name describing the block's purpose (e.g., "Database connection setup," "Input validation," "Recursive tree traversal"). Always visible.
- **Level 1 — Summary:** A concise paragraph covering what the block does, why it exists, key assumptions it makes, potential dangers or side effects, and ethical or security implications if relevant.
- **Level 2 — Line-by-Line Breakdown:** A detailed, line-by-line logic assessment of the block. Available on request for users who need maximum depth.

This gives experienced developers the ability to skim block labels and skip ahead, while giving newer developers the ability to drill into exactly the parts they don't understand — at their own pace, in their own order.

---

## 2. User Stories

### Primary Flow
1. As a student, I want to select specific files in a codebase and have an AI walk me through the code block by block, so I can understand what I'm submitting.
2. As a developer onboarding onto a new project, I want to quickly grasp the architecture of unfamiliar files without reading every line.
3. As a learner, I want to be able to drill down into line-by-line explanations for blocks I don't understand and skip the ones I do.

### Secondary
4. As a user, I want explanations to appear inline in the editor directly above or within the code blocks, so I never have to look away from the code I'm learning.
5. As a user, I want the agent to flag concepts I might not know (closures, recursion, dependency injection) and offer brief explainers without me having to ask.
6. As a privacy-conscious user, I want to run this entirely locally with a local LLM if I choose.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    VS Code Extension                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │  File Picker  │  │  Editor Overlay Layer             │  │
│  │  (TreeView    │  │  ┌────────────────────────────┐  │  │
│  │   Sidebar)    │──│  │ CodeLens Labels (per block) │  │  │
│  │              │  │  ├────────────────────────────┤  │  │
│  └──────────────┘  │  │ Block Highlights (bg color) │  │  │
│                    │  ├────────────────────────────┤  │  │
│  ┌──────────────┐  │  │ Inline Explanation Panel    │  │  │
│  │  Status Bar   │  │  │ (expandable decoration)    │  │  │
│  │  Controls     │  │  ├────────────────────────────┤  │  │
│  └──────────────┘  │  │ Hover Detail Provider       │  │  │
│                    │  └────────────────────────────┘  │  │
│                    └───────────────┬──────────────────┘  │
│                                   │                      │
│                    ┌──────────────┴──────────────┐       │
│                    │     Walkthrough Engine       │       │
│                    └──────────────┬──────────────┘       │
│                                   │                      │
│                    ┌──────────────┴──────────────┐       │
│                    │       LLM Adapter            │       │
│                    └──────────────┬──────────────┘       │
│                                   │                      │
│         ┌─────────────┬──────────┼──────────┐            │
│    ┌────┴────┐  ┌────┴────┐ ┌───┴────┐ ┌───┴─────┐     │
│    │ Ollama  │  │  Groq   │ │ Claude │ │ OpenAI  │     │
│    │ (local) │  │ (free)  │ │  API   │ │  API    │     │
│    └─────────┘  └─────────┘ └────────┘ └─────────┘     │
└──────────────────────────────────────────────────────────┘
```

### Components

#### 3.1 File Picker (TreeView Sidebar)
- Custom VS Code TreeView in the activity bar (sidebar icon)
- Displays the workspace file tree with checkboxes
- User selects files they want walked through
- "Start Walkthrough" button at the top of the panel
- Files are queued in the order selected
- Supports select-all, deselect-all, and file filtering by extension
- Shows status indicators: pending, in progress, completed, skipped

#### 3.2 Walkthrough Engine (Core Agent)
This is the **agentic** layer. It is not a single LLM call — it is a multi-step autonomous process:

1. **Segmentation Step:** Takes the full file content, determines logical block boundaries. The LLM decides where to split based on semantic meaning, not just syntax. A block might be a single function, a configuration section, or a chain of related statements.
2. **Analysis Step:** For each block, generates the three-tier explanation (label, summary, line-by-line). This can be batched or done per-block on demand.
3. **Concept Detection Step:** Identifies programming concepts, patterns, or domain-specific knowledge present in each block. Tags them for optional explainers.
4. **Danger Assessment Step:** Evaluates each block for assumptions, side effects, security implications, common bugs, and ethical concerns. This becomes part of the "Points to Consider" section in the summary.

The engine decides autonomously how to segment, what to flag, and what concepts to surface. This is the agent behavior — it's not just prompting, it's planning and acting on the code.

#### 3.3 Editor Overlay Layer (Inline UI)
Instead of a separate webview panel, all walkthrough UI lives directly inside the editor. This keeps the user's eyes on the code and eliminates context switching.

**CodeLens Labels (Level 0 — Always Visible):**
- A clickable CodeLens annotation appears above each identified block
- Format: `▶ Block Name — one-liner summary` (e.g., `▶ JWT Validation — Extracts and verifies the auth token from request headers`)
- Color-coded by difficulty: gray (trivial), blue (standard), orange (complex), red (critical)
- Clicking the CodeLens expands that block's explanation inline

**Block Highlights (Background Colors):**
- Each block gets a subtle background tint so the user can visually see where one block ends and the next begins
- The currently active/expanded block has a stronger highlight
- Inactive blocks have a faint alternating tint (like zebra-striping for code)
- Uses VS Code `TextEditorDecorationType` API

**Inline Explanation Panel (Level 1 — On Click):**
- When a user clicks a CodeLens label, an inline decoration expands below the CodeLens showing:
  - The summary paragraph
  - "Points to Consider" section (assumptions, dangers, side effects, ethical notes)
  - Tagged concepts as clickable badges (expand inline for mini-explainer)
  - A "Show Line-by-Line" button to load Level 2
  - A "Collapse" button to hide the explanation
- This panel is rendered as a VS Code webview-based decoration or a custom inline widget
- Only one block explanation is open at a time — expanding a new one collapses the previous

**Hover Detail Provider (Quick Peek):**
- Hovering over any line within a block shows a tooltip with that line's logic annotation (a preview of the Level 2 content)
- This provides a lightweight way to peek at line-level explanations without fully expanding Level 2
- Uses VS Code `HoverProvider` API

**Level 2 — Line-by-Line (On Demand):**
- When "Show Line-by-Line" is clicked, each line within the block gets a subtle inline annotation to its right or below showing the logic assessment
- Similar to how Error Lens shows error messages inline next to the offending line
- Can be toggled on/off for the active block

**Navigation Controls:**
- **Status bar:** Shows "CodeWalk: File 2/5 | Block 3/8" with previous/next buttons
- **Keyboard shortcuts:** `Alt+Down` next block, `Alt+Up` previous block, `Alt+Right` expand, `Alt+Left` collapse, `Alt+S` skip file
- **Command palette:** All navigation commands available via command palette (`CodeWalk: Next Block`, etc.)

#### 3.5 LLM Adapter (Backend Abstraction)
A clean interface that any LLM backend can implement:

```typescript
interface LLMAdapter {
  segment(code: string, language: string, filename: string): Promise<Segment[]>;
  explain(segment: Segment, depth: "summary" | "line-by-line"): Promise<Explanation>;
  detectConcepts(segment: Segment): Promise<Concept[]>;
}
```

**Supported backends (in priority order):**
1. **Ollama (local):** Privacy-first option. Recommended models: Llama 3 8B, CodeLlama, or Qwen 2.5 Coder. No API key needed, runs entirely on user's machine. Best for users with a dedicated GPU.
2. **Groq (free cloud):** Recommended default for most users. Free tier offers fast inference with Llama 3.3 70B. No cost, no GPU required, excellent code understanding. Requires free API key from groq.com.
3. **Anthropic Claude API:** Highest quality explanations. Pay-as-you-go pricing (a full walkthrough costs pennies). Requires API key. Uses claude-sonnet-4-20250514.
4. **OpenAI API:** Alternative cloud option. Requires API key in settings.

The extension auto-detects available backends at startup: checks for a running Ollama instance first, then falls back to whichever API key is configured. A first-run setup wizard walks the user through choosing and configuring a backend.

---

## 4. Data Schema

### Segment (one logical block of code)

```typescript
interface Segment {
  id: string;                    // Unique ID within the file
  label: string;                 // Short name: "Database connection setup"
  oneLiner: string;              // Single sentence summary
  startLine: number;             // First line in source file (1-indexed)
  endLine: number;               // Last line in source file (1-indexed)
  code: string;                  // Raw code content of this segment
  difficulty: "trivial" | "standard" | "complex" | "critical";
}
```

### Explanation

```typescript
interface Explanation {
  segmentId: string;
  summary: string;                // Paragraph-length explanation
  pointsToConsider: {
    assumptions: string[];        // What this code assumes to be true
    dangers: string[];            // Security, performance, correctness risks
    ethicalNotes: string[];       // Ethical or privacy implications (if any)
    sideEffects: string[];        // External state changes, mutations, I/O
  };
  concepts: Concept[];            // Programming concepts present
  lineByLine?: LineAnnotation[];  // Only populated when user requests Level 2
}
```

### Concept

```typescript
interface Concept {
  name: string;                   // "Closure", "Dependency Injection", etc.
  briefExplainer: string;         // 2-3 sentence explanation
  relevance: string;              // Why it matters in this specific block
}
```

### LineAnnotation

```typescript
interface LineAnnotation {
  lineNumber: number;
  code: string;                   // The actual line of code
  logic: string;                  // What this line does and why
}
```

---

## 5. UX Flow (Step by Step)

### Starting a Walkthrough
1. User clicks the CodeWalk icon in the VS Code activity bar (sidebar)
2. File picker tree view opens showing workspace files with checkboxes
3. User checks the files they want to walk through
4. User clicks "Start Walkthrough"
5. First selected file opens in the editor
6. Status bar shows "CodeWalk: File 1/N | Analyzing..."

### During a Walkthrough
7. The engine segments the file; CodeLens labels appear above each block as they're identified
8. Block backgrounds are tinted with subtle difficulty-coded colors
9. The first block auto-expands its inline explanation (if setting enabled)
10. User reads the summary and Points to Consider directly in the editor
11. User can:
    - Click any CodeLens label to expand/collapse that block's explanation
    - Hover over individual lines to see quick logic tooltips
    - Click "Show Line-by-Line" within an expanded explanation for full Level 2 annotations
    - Press `Alt+Down` / `Alt+Up` to navigate between blocks
    - Press `Alt+S` to skip to the next queued file
    - Click the status bar for a quick-nav dropdown of all blocks
12. Only one block explanation is expanded at a time — expanding a new one collapses the previous

### Ending a Walkthrough
13. After the last file, status bar shows "CodeWalk: Complete"
14. A notification offers: "Walkthrough complete — 5 files, 32 blocks analyzed. Start another?"
15. All decorations and CodeLens labels are cleared when the walkthrough ends

---

## 6. Prompt Engineering Strategy

The quality of CodeWalk depends entirely on prompt design. Key principles:

### Segmentation Prompt
- Instruct the LLM to split by **semantic purpose**, not syntax
- A segment should answer: "What is this block trying to accomplish?"
- Segments should be between 3-30 lines typically (the LLM decides, not a hard rule)
- Import blocks, config blocks, and boilerplate should be identified as "trivial" difficulty
- The LLM must return structured JSON matching the Segment schema

### Explanation Prompt
- Explain as if teaching a student who can read code but doesn't understand the *why*
- Avoid jargon unless the jargon is tagged as a Concept with an explainer
- Points to Consider should be specific, not generic (e.g., "This SQL query is vulnerable to injection because the input on line 14 is not parameterized" — not just "Be careful with SQL")
- Line-by-line should explain logic and intent, not just restate the code in English

### Concept Detection Prompt
- Only flag concepts that a student might not know
- Don't flag basic syntax (for loops, if statements) unless used in a non-obvious way
- Brief explainers should be self-contained — no external references needed

### Source Grounding
- Explanations should be grounded in what the code actually does, verified against the source
- The agent should avoid hallucinated behavior descriptions
- Stretch goal: sandbox execution to verify claims

---

## 7. Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension framework | VS Code Extension API (TypeScript) |
| Inline UI | CodeLens, Decorations, HoverProvider, Webview-based inline widgets |
| Build system | esbuild or webpack (VS Code standard) |
| LLM communication | HTTP requests to Ollama / Groq / Anthropic / OpenAI |
| State management | VS Code ExtensionContext.workspaceState |
| Editor integration | VS Code Decorations API, CodeLens API, HoverProvider API |
| Package manager | npm |

---

## 8. Extension Settings

```json
{
  "codewalk.llmBackend": {
    "type": "string",
    "enum": ["ollama", "groq", "anthropic", "openai"],
    "default": "groq",
    "description": "LLM backend for code analysis"
  },
  "codewalk.ollamaModel": {
    "type": "string",
    "default": "llama3:8b",
    "description": "Ollama model to use for local inference"
  },
  "codewalk.ollamaEndpoint": {
    "type": "string",
    "default": "http://localhost:11434",
    "description": "Ollama API endpoint"
  },
  "codewalk.groqApiKey": {
    "type": "string",
    "default": "",
    "description": "Groq API key (free at groq.com)"
  },
  "codewalk.groqModel": {
    "type": "string",
    "default": "llama-3.3-70b-versatile",
    "description": "Groq model to use"
  },
  "codewalk.anthropicApiKey": {
    "type": "string",
    "default": "",
    "description": "Anthropic API key (if using Claude backend)"
  },
  "codewalk.openaiApiKey": {
    "type": "string",
    "default": "",
    "description": "OpenAI API key (if using OpenAI backend)"
  },
  "codewalk.autoExpandFirst": {
    "type": "boolean",
    "default": true,
    "description": "Automatically expand the first block when a walkthrough starts"
  },
  "codewalk.showBlockHighlights": {
    "type": "boolean",
    "default": true,
    "description": "Show background color tints for code blocks in the editor"
  },
  "codewalk.showHoverAnnotations": {
    "type": "boolean",
    "default": true,
    "description": "Show line-level logic tooltips on hover"
  }
}
```

---

## 9. MVP Scope vs. Stretch Goals

### MVP (Class Deliverable)
- [ ] File picker with checkboxes (TreeView sidebar)
- [ ] CodeLens labels above each code block with name and one-liner
- [ ] Three-tier progressive disclosure (CodeLens label → inline summary → line-by-line)
- [ ] Block background highlighting with difficulty color coding
- [ ] Inline expandable explanation panel on CodeLens click
- [ ] Points to Consider section (assumptions, dangers, side effects)
- [ ] Block navigation via status bar and keyboard shortcuts
- [ ] File queue with skip functionality
- [ ] Single LLM backend working (Groq recommended for demo)
- [ ] Progress indicator in status bar (file X of Y, block X of Y)

### Stretch Goals
- [ ] Hover tooltips with per-line logic annotations
- [ ] Concept detection and inline mini-explainers
- [ ] "Mark as Understood" tracking per block
- [ ] Multiple LLM backend support with settings toggle and auto-detection
- [ ] First-run setup wizard for backend configuration
- [ ] Walkthrough summary screen at completion
- [ ] Sandbox execution to verify explanations
- [ ] Caching of explanations (don't re-analyze unchanged files)
- [ ] Difficulty-based filtering (show only complex/critical blocks)
- [ ] Custom segmentation rules per language
- [ ] Export walkthrough as structured Markdown

---

## 10. Agent Behavior — What Makes This Agentic

This is not a wrapper around a single LLM prompt. The agentic qualities are:

1. **Autonomous Segmentation:** The agent decides where to split the code. It reasons about logical boundaries, not just syntactic ones. It makes judgment calls about what constitutes a meaningful block.

2. **Multi-Step Pipeline:** The agent runs a sequence of steps (segment → analyze → detect concepts → assess dangers) with each step's output informing the next. This is a plan-execute loop, not a single call.

3. **On-Demand Depth:** The agent only generates line-by-line breakdowns when requested, making resource-efficient decisions about when to do expensive analysis.

4. **Adaptive Difficulty Assessment:** The agent evaluates each block's complexity relative to the full file and tags accordingly. A block that's trivial in isolation might be flagged as complex if it interacts with non-obvious state elsewhere in the file.

5. **Concept Awareness:** The agent maintains awareness of what programming concepts appear across the walkthrough and can surface explanations for patterns it detects — going beyond what the user explicitly asked to explain.

---

## 11. File Structure

```
codewalk/
├── package.json                  # Extension manifest
├── tsconfig.json
├── esbuild.config.js
├── README.md
├── CHANGELOG.md
├── .vscodeignore
├── src/
│   ├── extension.ts              # Extension entry point (activate/deactivate)
│   ├── commands/
│   │   ├── startWalkthrough.ts   # Main command handler
│   │   ├── stopWalkthrough.ts
│   │   └── navigation.ts        # Next/prev block, skip file commands
│   ├── providers/
│   │   ├── filePickerProvider.ts  # TreeView data provider for sidebar
│   │   ├── codeLensProvider.ts   # CodeLens labels above each block
│   │   ├── hoverProvider.ts      # Line-level hover tooltips
│   │   └── inlinePanel.ts       # Expandable inline explanation widget
│   ├── engine/
│   │   ├── walkthroughEngine.ts  # Core agent orchestration
│   │   ├── segmenter.ts          # Code segmentation logic
│   │   ├── analyzer.ts           # Explanation generation
│   │   └── conceptDetector.ts    # Concept identification
│   ├── llm/
│   │   ├── adapter.ts            # LLM interface definition
│   │   ├── ollamaAdapter.ts      # Ollama implementation
│   │   ├── groqAdapter.ts        # Groq free tier implementation
│   │   ├── anthropicAdapter.ts   # Claude API implementation
│   │   └── openaiAdapter.ts      # OpenAI implementation
│   ├── editor/
│   │   ├── highlights.ts         # Block background color decorations
│   │   └── statusBar.ts         # Status bar progress and controls
│   ├── types/
│   │   └── index.ts              # Shared TypeScript interfaces
│   └── utils/
│       ├── prompts.ts            # All LLM prompt templates
│       └── config.ts             # Settings reader and backend detection
├── media/
│   └── icon.svg                  # Activity bar icon
└── test/
    └── ...
```

---

## 12. Technical Implementation Guide — Inline Editor UI

This is the most critical section for implementation. VS Code's extension API does **not** natively support rich, expandable inline panels inside the editor. However, there are multiple APIs that can be combined to achieve the desired UX. This section documents the research, tradeoffs, and recommended approach.

### 12.1 Key Reference: VS Code's Official "Code Tutor" Tutorial

VS Code maintains an official tutorial at `https://code.visualstudio.com/api/extension-guides/ai/language-model-tutorial` that builds an almost identical concept — an AI-powered code annotation extension. The complete source code is at `https://github.com/microsoft/vscode-extension-samples/tree/main/lm-api-tutorial`.

**What the tutorial demonstrates:**
- Using `registerTextEditorCommand` to access the active editor
- Getting visible code with line numbers via `textEditor.visibleRanges`
- Sending code to an LLM with a structured prompt that returns JSON
- Streaming response parsing — accumulating fragments and parsing on `}` boundaries
- Displaying results using `TextEditorDecorationType` with `after.contentText` for short inline text
- Using `hoverMessage` on decorations for full explanation on hover

**What we can reuse directly:**
- The visible code extraction pattern
- The streaming JSON parse pattern
- The decoration + hover pattern for Level 2 (line-by-line annotations)

**Where we diverge:**
- The tutorial uses GitHub Copilot's Language Model API (`vscode.lm.selectChatModels`). CodeWalk uses external LLM APIs (Groq, Ollama, Claude) via HTTP, which means we don't depend on Copilot being installed
- The tutorial does flat per-line annotations. CodeWalk does hierarchical block segmentation with three depth levels
- The tutorial has no block navigation, no file queue, no progressive disclosure

### 12.2 Available VS Code APIs and Their Roles

#### API 1: CodeLens (`vscode.CodeLensProvider`) — Level 0 Block Labels

**Purpose:** Clickable labels that appear above lines of code, inline in the editor.

**How it works:**
```typescript
class CodeWalkLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    // For each segment, create a CodeLens at the start line
    return segments.map(seg => {
      const range = new vscode.Range(seg.startLine - 1, 0, seg.startLine - 1, 0);
      return new vscode.CodeLens(range, {
        title: `▶ ${seg.label} — ${seg.oneLiner}`,
        command: 'codewalk.expandBlock',
        arguments: [seg.id]
      });
    });
  }
}
```

**Strengths:** Native VS Code UI, clickable, always visible, no extra panels. Familiar to any VS Code user (looks like "N references" from TypeScript).

**Limitations:** Text-only labels — no markdown, no rich content, no expand/collapse within the CodeLens itself. The CodeLens is just a clickable trigger; the expanded explanation must be rendered by a different API.

**Verdict:** Perfect for Level 0. Use for all block labels.

#### API 2: TextEditorDecorationType — Block Highlighting & Line Annotations

**Purpose:** Background colors, inline text, and hover messages attached to code ranges.

**How it works (block backgrounds):**
```typescript
const blockHighlight = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(100, 149, 237, 0.08)', // subtle blue tint
  isWholeLine: true,
});

// Apply to a range of lines
editor.setDecorations(blockHighlight, [
  { range: new vscode.Range(startLine, 0, endLine, maxCol) }
]);
```

**How it works (inline line annotations — Level 2):**
```typescript
const lineAnnotation = vscode.window.createTextEditorDecorationType({
  after: {
    contentText: ' → Extracts user ID from JWT payload',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
    fontStyle: 'italic',
    margin: '0 0 0 1em'
  }
});

// Apply with hover for full detail
editor.setDecorations(lineAnnotation, [{
  range: new vscode.Range(line, lineLength, line, lineLength),
  hoverMessage: new vscode.MarkdownString('**Line Logic:** This line extracts...')
}]);
```

**Strengths:** Lightweight, native, performant. Background colors are perfect for visual block separation. The `after.contentText` pattern (used by Error Lens) is excellent for Level 2 line annotations. `hoverMessage` supports full Markdown.

**Limitations:** `after.contentText` is plain text only (no markdown, no HTML). No interactivity beyond hover. Cannot create expandable/collapsible regions.

**Verdict:** Use for block background highlighting and Level 2 line-by-line annotations with truncated inline text + rich hover.

#### API 3: HoverProvider (`vscode.HoverProvider`) — Quick Peek Tooltips

**Purpose:** Rich markdown content that appears on mouse hover at any position.

**How it works:**
```typescript
class CodeWalkHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const segment = findSegmentAtLine(position.line);
    if (!segment || !segment.lineAnnotations) return;

    const annotation = segment.lineAnnotations.find(a => a.lineNumber === position.line + 1);
    if (!annotation) return;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${annotation.logic}**\n\n`);
    md.appendMarkdown(`Part of: *${segment.label}*`);
    md.isTrusted = true; // allows command links
    return new vscode.Hover(md);
  }
}
```

**Strengths:** Rich Markdown support, including bold, italic, code blocks, links, and even command URIs (clickable links that trigger extension commands). Positioned exactly where the user hovers.

**Limitations:** Disappears when mouse moves away. Not persistent. Not suitable for reading long explanations.

**Verdict:** Use as an optional quick-peek layer. Nice-to-have, not essential for MVP.

#### API 4: Comment Controller (`vscode.comments.createCommentController`) — Level 1 Expandable Explanations

**Purpose:** Rich, persistent, collapsible annotation threads positioned at specific line ranges in the editor. This is the same API used by the GitHub Pull Request extension for inline code review comments.

**How it works:**
```typescript
// Create the controller once
const commentController = vscode.comments.createCommentController(
  'codewalk',
  'CodeWalk Explanations'
);

// Create a thread at a specific block range
function expandBlock(segment: Segment, explanation: Explanation, uri: vscode.Uri) {
  const range = new vscode.Range(segment.startLine - 1, 0, segment.endLine - 1, 0);

  const body = new vscode.MarkdownString();
  body.appendMarkdown(`## ${segment.label}\n\n`);
  body.appendMarkdown(`${explanation.summary}\n\n`);
  body.appendMarkdown(`### Points to Consider\n`);
  explanation.pointsToConsider.assumptions.forEach(a =>
    body.appendMarkdown(`- **Assumption:** ${a}\n`)
  );
  explanation.pointsToConsider.dangers.forEach(d =>
    body.appendMarkdown(`- **Danger:** ${d}\n`)
  );
  body.isTrusted = true;

  const comment: vscode.Comment = {
    body: body,
    mode: vscode.CommentMode.Preview,
    author: { name: 'CodeWalk' }
  };

  const thread = commentController.createCommentThread(uri, range, [comment]);
  thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  thread.canReply = false; // no reply box needed
  thread.label = segment.label;
}
```

**Strengths:**
- Full Markdown rendering in comment body (headings, bold, lists, code blocks, links)
- Native expand/collapse behavior (`CommentThreadCollapsibleState.Collapsed` / `.Expanded`)
- Positioned at exact line ranges — the comment thread visually attaches to the code block
- Supports custom commands via `comment/title` and `commentThread/title` menu contributions in `package.json` (this is how we add a "Show Line-by-Line" button)
- Persistent — doesn't disappear on mouse move
- Already familiar to users who use GitHub PR extension
- Shows up in the Comments panel in the sidebar, giving an overview of all blocks

**Limitations:**
- The UI looks like "comments" (speech bubble icon, comment thread styling). This is cosmetic but may feel slightly off-brand for a walkthrough tool. The `author.name` field helps brand it as "CodeWalk"
- Each thread has a reply box by default (set `canReply: false` to hide it)
- Performance with many threads (20+) on a single file may need testing
- Markdown rendering is rich but not arbitrary HTML — no custom styling beyond what Markdown supports

**Verdict:** This is the **recommended primary approach for Level 1 explanations**. It gives us expandable, persistent, markdown-rich content positioned at exact code ranges — exactly what the design calls for.

### 12.3 Recommended Implementation Strategy

Use a hybrid of all four APIs, each handling the layer it's best suited for:

```
┌─────────────────────────────────────────────────────────┐
│                    INLINE UI LAYERS                       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ LEVEL 0: CodeLens (always visible)               │    │
│  │ "▶ JWT Validation — Verifies auth token"         │    │
│  │ Clicking triggers Level 1 expand via Comment API │    │
│  └─────────────────────────────────────────────────┘    │
│                         │ click                          │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ LEVEL 1: Comment Controller (expand/collapse)    │    │
│  │ Rich markdown: summary, Points to Consider,     │    │
│  │ concept tags. Persistent. Collapsible.           │    │
│  │ [Show Line-by-Line] button triggers Level 2      │    │
│  └─────────────────────────────────────────────────┘    │
│                         │ click button                   │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ LEVEL 2: Decorations (inline after-text)         │    │
│  │ Short annotation after each line + hover for     │    │
│  │ full detail. Like Error Lens style.              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ BACKGROUND: Decorations (block highlighting)     │    │
│  │ Subtle color tints per block, always active      │    │
│  │ during walkthrough. Difficulty color-coded.      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 12.4 Implementation Order for Claude Code

Build in this order to get a working demo as fast as possible:

**Phase 1 — Core Loop (get something working):**
1. Scaffold the extension with `yo code` (TypeScript)
2. Implement the LLM adapter interface and the Groq adapter (HTTP fetch to `https://api.groq.com/openai/v1/chat/completions`)
3. Implement the segmenter — send full file content to LLM, get back JSON array of segments
4. Implement a basic CodeLensProvider that displays block labels
5. Implement basic background decorations for block highlighting
6. Register the `codewalk.startWalkthrough` command that triggers segmentation on the active file

**Phase 2 — Level 1 Explanations:**
7. Implement the Comment Controller for expandable explanations
8. Wire CodeLens click → `codewalk.expandBlock` command → create/toggle comment thread
9. Implement "collapse previous when expanding new" logic
10. Add Points to Consider content to the comment body

**Phase 3 — Navigation & File Queue:**
11. Implement the TreeView file picker with checkboxes
12. Implement status bar progress display
13. Implement next/previous block keyboard shortcuts
14. Implement file skip and file queue advancement

**Phase 4 — Level 2 & Polish:**
15. Implement line-by-line annotation request (on-demand LLM call)
16. Apply `after.contentText` decorations for inline line annotations
17. Add hover messages for full line-level detail
18. Add difficulty color coding to CodeLens labels and block backgrounds
19. Implement cleanup/dispose for all decorations and threads on walkthrough end

### 12.5 Critical Implementation Notes

**Managing Comment Thread Lifecycle:**
Comment threads persist until explicitly disposed. The extension must track all active threads and dispose them when:
- The user collapses a block (dispose thread, re-create if expanded again)
- The user skips a file or ends the walkthrough
- The extension deactivates

```typescript
// Track active threads for cleanup
const activeThreads: Map<string, vscode.CommentThread> = new Map();

function toggleBlock(segmentId: string) {
  if (activeThreads.has(segmentId)) {
    activeThreads.get(segmentId)!.dispose();
    activeThreads.delete(segmentId);
  } else {
    // Collapse any other expanded thread first
    activeThreads.forEach(thread => thread.dispose());
    activeThreads.clear();
    // Create new thread for this segment
    const thread = createExplanationThread(segmentId);
    activeThreads.set(segmentId, thread);
  }
}

function disposeAllThreads() {
  activeThreads.forEach(thread => thread.dispose());
  activeThreads.clear();
}
```

**Decoration Lifecycle:**
Each `TextEditorDecorationType` must be disposed when no longer needed. Create decoration types once, reuse them, and dispose on walkthrough end. Do NOT create a new `TextEditorDecorationType` for every line — this leaks memory. Instead, create one type per visual style and apply it to multiple ranges.

**CodeLens Refresh:**
After segmentation completes, the CodeLens provider needs to signal VS Code to refresh. Use an `EventEmitter`:

```typescript
class CodeWalkLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }
}
```

**Adding Custom Buttons to Comment Threads:**
To add a "Show Line-by-Line" button to a comment thread, register a command in `package.json` under `contributes.menus`:

```json
{
  "contributes": {
    "menus": {
      "comments/commentThread/title": [
        {
          "command": "codewalk.showLineByLine",
          "group": "inline",
          "when": "commentController == codewalk"
        }
      ]
    }
  }
}
```

This places a clickable action in the title bar of comment threads created by the `codewalk` controller.

**LLM Response Streaming:**
For the segmentation call, don't wait for the full response. Stream segments in and render CodeLens labels as each segment arrives. Use the same `}` boundary parsing pattern from the VS Code tutorial, but look for complete segment JSON objects:

```typescript
let accumulatedResponse = '';
for await (const chunk of stream) {
  accumulatedResponse += chunk;
  // Try to extract complete segment objects as they arrive
  const segments = tryParseSegments(accumulatedResponse);
  if (segments.length > lastRenderedCount) {
    codeLensProvider.updateSegments(segments);
    codeLensProvider.refresh();
  }
}
```

### 12.6 Fallback Strategy

If the Comment Controller approach proves too complex for the class deadline, there is a simpler fallback that still delivers a good demo:

**Simplified approach — Decorations + Hover only (no Comment Controller):**
- CodeLens for block labels (same as recommended)
- Clicking a CodeLens adds `after.contentText` decoration below the block's last line with a truncated summary (first 80 chars)
- The full explanation lives in `hoverMessage` (rich Markdown) — user hovers to read it
- Line-by-line annotations use the same pattern: truncated inline text + hover for detail

This is essentially the approach from VS Code's official Code Tutor tutorial, extended with CodeLens and block navigation. It's less visually impressive but fully functional and much simpler to implement.

### 12.7 package.json Contribution Points

The following `contributes` section covers all the UI integration points:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "codewalk.startWalkthrough",
        "title": "Start CodeWalk",
        "icon": "$(book)"
      },
      {
        "command": "codewalk.stopWalkthrough",
        "title": "Stop CodeWalk"
      },
      {
        "command": "codewalk.nextBlock",
        "title": "CodeWalk: Next Block"
      },
      {
        "command": "codewalk.prevBlock",
        "title": "CodeWalk: Previous Block"
      },
      {
        "command": "codewalk.skipFile",
        "title": "CodeWalk: Skip File"
      },
      {
        "command": "codewalk.expandBlock",
        "title": "Expand Explanation"
      },
      {
        "command": "codewalk.showLineByLine",
        "title": "Show Line-by-Line",
        "icon": "$(list-ordered)"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "codewalk.startWalkthrough",
          "group": "navigation",
          "when": "!codewalk.isActive"
        },
        {
          "command": "codewalk.stopWalkthrough",
          "group": "navigation",
          "when": "codewalk.isActive"
        }
      ],
      "comments/commentThread/title": [
        {
          "command": "codewalk.showLineByLine",
          "group": "inline",
          "when": "commentController == codewalk"
        }
      ]
    },
    "keybindings": [
      {
        "command": "codewalk.nextBlock",
        "key": "alt+down",
        "when": "codewalk.isActive"
      },
      {
        "command": "codewalk.prevBlock",
        "key": "alt+up",
        "when": "codewalk.isActive"
      },
      {
        "command": "codewalk.skipFile",
        "key": "alt+s",
        "when": "codewalk.isActive"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "codewalk",
          "title": "CodeWalk",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "codewalk": [
        {
          "id": "codewalk.filePicker",
          "name": "Files"
        }
      ]
    }
  }
}
```

