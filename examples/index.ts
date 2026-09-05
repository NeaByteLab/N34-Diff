/**
 * Ollama + N34 apply_edit example.
 *
 * Prereqs
 *   - Ollama with an OpenAI-compatible /v1 endpoint reachable at OLLAMA_HOST
 *   - A model that supports tool calling (default: gemma4:31b, override with OLLAMA_MODEL)
 *   - Optional OLLAMA_API_KEY if the endpoint is protected
 *
 * Run
 *   deno run --allow-net --allow-env --allow-read examples/index.ts
 */
import N34 from '@neabyte/n34-diff'

/**
 * OpenAI-style tool call payload.
 * @description Shape of one tool call from chat reply.
 */
type ToolCall = {
  /** Tool call identifier */
  id?: string
  /** Tool call kind marker */
  type?: 'function'
  /** Function name and arguments */
  function: { name: string; arguments: string }
}

/**
 * One chat completion message record.
 * @description Message shape used in requests and replies.
 */
type ChatMessage = {
  /** Message role tag */
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** Text content or null */
  content: string | null
  /** Tool calls emitted by assistant */
  tool_calls?: ToolCall[]
  /** Tool call id being answered */
  tool_call_id?: string
  /** Optional message name */
  name?: string
}

/**
 * Chat completions response body.
 * @description Choices array wrapping one assistant reply.
 */
type ChatReply = {
  /** Reply choices returned by model */
  choices: Array<{ message: ChatMessage; finish_reason: string }>
}

/**
 * Arguments accepted by apply_edit tool.
 * @description File path plus N34 edit body payload.
 */
type EditArgs = {
  /** Target file path */
  path: string
  /** N34 edit body text */
  content: string
}

/** Source text sent to the model */
const source = `import { readFile, writeFile } from 'node:fs/promises'

class UserService {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.cache = {}
  }

  async getUser(id) {
    if (this.cache[id]) return this.cache[id]
    const raw = await readFile(this.dbPath, 'utf8')
    const users = JSON.parse(raw)
    const user = users.find(u => u.id == id)
    this.cache[id] = user
    return user
  }

  async saveUser(user) {
    const raw = await readFile(this.dbPath, 'utf8')
    const users = JSON.parse(raw)
    const idx = users.findIndex(u => u.id == user.id)
    if (idx >= 0) users[idx] = user
    else users.push(user)
    await writeFile(this.dbPath, JSON.stringify(users))
    this.cache[user.id] = user
  }
}

export default UserService
`

/** Ollama bearer token or empty string */
const apiKey = Deno.env.get('OLLAMA_API_KEY') ?? ''
/** Raw HTTP reply from chat completions */
const reply = await fetch(
  `${
    (Deno.env.get('OLLAMA_HOST') ?? 'https://ollama.com').replace(
      /\/+$/,
      ''
    )
  }/v1/chat/completions`,
  {
    method: 'POST',
    headers: apiKey.length > 0
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
      : { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OLLAMA_MODEL') ?? 'gemma4:31b',
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            'Refactor the UserService class:',
            '1. Replace loose equality (==) with strict equality (===).',
            '2. Wrap readFile / writeFile / JSON.parse in try/catch that rethrows a clear error.',
            '3. Add JSDoc comments on both methods.',
            '4. Rename cache to userCache.',
            '',
            'File path: /tmp/user-service.js',
            '',
            '```js',
            source,
            '```'
          ].join('\n')
        }
      ],
      tools: [
        JSON.parse(
          await Deno.readTextFile(new URL('../schemas/openai.json', import.meta.url))
        ) as Record<string, unknown>
      ],
      tool_choice: 'auto'
    })
  }
)
if (!reply.ok) {
  throw new TypeError(`Ollama returned HTTP ${reply.status} with body ${await reply.text()}`)
}
/** Assistant message from the first choice */
const assistant = ((await reply.json()) as ChatReply).choices[0]?.message
if (!assistant) {
  throw new TypeError('no assistant message in Ollama response')
}
/** Tool calls emitted by the assistant */
const calls = assistant.tool_calls ?? []
if (calls.length === 0) {
  console.log('Model refused to call the tool. Raw content:')
  console.log(assistant.content ?? '(empty)')
  Deno.exit(1)
}
for (const call of calls) {
  if (call.function.name !== 'apply_edit') {
    console.log(`Skipping unknown tool call ${call.function.name}`)
    continue
  }
  const parsed = JSON.parse(call.function.arguments) as EditArgs
  console.log('---')
  console.log(`Tool call apply_edit path=${parsed.path}`)
  console.log('Edit body from model')
  console.log(parsed.content)
  console.log('---')
  const patch = N34.apply(source, parsed.content, { timeout: 10000 })
  const width = Math.max(...patch.diff.map((line) => line.value.length), 20)
  /**
   * Pad text to column width.
   * @param text - Text to pad
   * @returns Text padded with spaces
   */
  const pad = (text: string): string => text.padEnd(width, ' ')
  /**
   * Format a line number column.
   * @param value - Line number or null
   * @returns Right-aligned three-character string
   */
  const num = (value: number | null): string =>
    value === null ? '   ' : String(value).padStart(3, ' ')
  /** Rendered diff rows collected for output */
  const rows: string[] = []
  /** ANSI color escape codes for output */
  const paint = {
    red: '\x1b[48;2;255;215;215m\x1b[38;2;103;27;27m',
    green: '\x1b[48;2;198;239;206m\x1b[38;2;20;76;40m',
    dim: '\x1b[90m',
    reset: '\x1b[0m'
  }
  let cursor = 0
  while (cursor < patch.diff.length) {
    const line = patch.diff[cursor]!
    if (line.type === 'equal') {
      rows.push(
        `${paint.dim}${num(line.oldLine)}${paint.reset}  ${
          pad(
            line.value
          )
        }  ${paint.dim}\u2502${paint.reset}  ${paint.dim}${num(line.newLine)}${paint.reset}  ${
          pad(
            line.value
          )
        }`
      )
      cursor += 1
      continue
    }
    const deletes: typeof patch.diff = []
    while (cursor < patch.diff.length && patch.diff[cursor]!.type === 'delete') {
      deletes.push(patch.diff[cursor]!)
      cursor += 1
    }
    const adds: typeof patch.diff = []
    while (cursor < patch.diff.length && patch.diff[cursor]!.type === 'add') {
      adds.push(patch.diff[cursor]!)
      cursor += 1
    }
    const span = Math.max(deletes.length, adds.length)
    for (let row = 0; row < span; row += 1) {
      const del = deletes[row]
      const add = adds[row]
      const left = del
        ? `${paint.dim}${num(del.oldLine)}${paint.reset}  ${paint.red}${
          pad(
            del.value
          )
        }${paint.reset}`
        : `${paint.dim}${num(null)}${paint.reset}  ${pad('')}`
      const right = add
        ? `${paint.dim}${num(add.newLine)}${paint.reset}  ${paint.green}${
          pad(
            add.value
          )
        }${paint.reset}`
        : `${paint.dim}${num(null)}${paint.reset}  ${pad('')}`
      rows.push(`${left}  ${paint.dim}\u2502${paint.reset}  ${right}`)
    }
  }
  console.log('Side-by-side diff')
  console.log(rows.join('\n'))
}
