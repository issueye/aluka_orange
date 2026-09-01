# Aluka

TypeScript AI agent that follows the [pi-agent](https://github.com/earendil-works/pi) layering and loads **existing pi extensions** without rewriting them.

Aluka is not a fork of pi. It implements the same extension contract:

- `export default function (pi: ExtensionAPI) { ... }`
- `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`
- discovery from `~/.pi/agent/extensions/` and `.pi/extensions/`
- jiti TypeScript loading, no compile step for plugins
- import aliases for `@earendil-works/pi-coding-agent`, `@mariozechner/pi-coding-agent`, `pi-ai`, `pi-tui`, and `typebox`

## Layers

```
CLI / REPL
  └── coding harness (tools, session, skills, extensions)
        └── agent-core (tool loop, events, abort)
              └── ai (OpenAI-compatible + Anthropic)
```

Built-in tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`.

## Setup

```bash
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` (or `ALUKA_API_KEY`) and optionally `OPENAI_BASE_URL` / `OPENAI_MODEL`. Any OpenAI-compatible endpoint works (DeepSeek, Qwen, Ollama, vLLM).

Provider requests have an idle timeout (default 120s): if no response headers arrive, or the SSE stream goes silent, the run fails with a retryable "timed out" error instead of hanging forever. Tune or disable with `ALUKA_STALL_TIMEOUT_MS` (milliseconds; `0` disables).

```bash
npm test
npx tsx src/cli.ts --help
npx tsx src/cli.ts -e ./examples/extensions/greet.ts -p "greet me"
```

After `npm run build`:

```bash
node dist/cli.js -p "list files in this repo"
```

## Using pi extensions

Drop a pi extension into any of:

| Path | Scope |
|------|--------|
| `~/.pi/agent/extensions/*.ts` | Global (pi + Aluka) |
| `~/.aluka/agent/extensions/*.ts` | Global (Aluka only) |
| `.pi/extensions/*.ts` | Project |
| `.aluka/extensions/*.ts` | Project |

Or pass `-e ./path.ts`.

Example (same as pi):

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: "text", text: `Hello, ${params.name}!` }] };
    },
  });
}
```

Imports of `@earendil-works/*` and `@mariozechner/*` are rewritten to Aluka at load time, so existing plugin source does not need to change.

## Compatibility notes

Fully supported for typical plugins:

- tools, commands, flags, session events, tool_call / tool_result interception
- `ctx.ui.notify / confirm / select / input`
- skills as Markdown under `.pi/skills` or `.aluka/skills`

Not a full pi TUI clone:

- `ctx.ui.custom()` and `@earendil-works/pi-tui` custom components are stubs
- OAuth login flows and session tree UI are not implemented yet

Plugins that only register tools, commands, and event gates should run as-is.
