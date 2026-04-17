# CodeWalk

VS Code extension that turns files into guided, AI-narrated walkthroughs — block by block.

This repo currently implements **Phase 1 — Core Loop**. Running `CodeWalk: Start Walkthrough` on an open file segments it via an LLM and renders clickable CodeLens labels plus difficulty-tinted block backgrounds. Clicking a label is a no-op in Phase 1; expansion arrives in Phase 2.

## Development

```bash
cd codewalk
npm install
npm run build
npm test
```

Press `F5` in VS Code with the `codewalk/` folder open to launch an Extension Development Host with the extension loaded.

## Backends

The shipped default is `ollama-local`. Other supported presets (configurable via `codewalk.backend`): `openrouter`, `groq`, `openai`, `anthropic-oai`, `together`, `custom`. Each preset fills in a sensible `baseUrl` and default `model`; user settings `codewalk.apiKey`, `codewalk.model`, and `codewalk.baseUrl` override where provided.

## Packaging

```bash
cd codewalk
npm run package
```

Produces `codewalk-0.1.0.vsix`.
