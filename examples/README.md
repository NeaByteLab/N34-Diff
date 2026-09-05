# Examples

Runnable demo of `apply_edit` tool-calling with N34.

## Examples

| File                     | Provider | What it shows                                              |
| ------------------------ | -------- | ---------------------------------------------------------- |
| [`index.ts`](./index.ts) | Ollama   | Chat with tool call, apply patch, print side-by-side diff  |

## Run

```bash
deno run --allow-net --allow-env --allow-read examples/index.ts
```

## Environment

| Variable         | Required | Default              | Purpose                              |
| ---------------- | -------- | -------------------- | ------------------------------------ |
| `OLLAMA_HOST`    | No       | `https://ollama.com` | Base URL of OpenAI-compatible `/v1`  |
| `OLLAMA_MODEL`   | No       | `gemma4:31b`         | Chat model that supports tool calls  |
| `OLLAMA_API_KEY` | No       | `""`                 | Bearer token when the endpoint gates |

Inline set for one run:

```bash
OLLAMA_HOST=https://ollama.com \
OLLAMA_MODEL=gemma4:31b \
OLLAMA_API_KEY=sk-xxxx \
deno run --allow-net --allow-env --allow-read examples/index.ts
```

Export for the session:

```bash
export OLLAMA_HOST=https://ollama.com
export OLLAMA_MODEL=gemma4:31b
export OLLAMA_API_KEY=sk-xxxx
deno run --allow-net --allow-env --allow-read examples/index.ts
```

Local Ollama server:

```bash
export OLLAMA_HOST=http://localhost:11434
export OLLAMA_MODEL=qwen2.5-coder:7b
deno run --allow-net --allow-env --allow-read examples/index.ts
```

## Use Cases

- Handoff agent, planner LLM emits `apply_edit`, executor runs `N34.apply` on the patched file.
- Proxy server, intercept chat traffic, run `apply_edit` server-side, return the diff to caller.
- Direct integration, load `schemas/*.json` into your tool loop, pipe args into `N34.apply`.
