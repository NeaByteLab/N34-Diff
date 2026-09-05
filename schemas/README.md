# Schema

Tool calling schemas for the `apply_edit` function across different LLM providers.

## Files

| File                               | Provider  | Format                                                  |
| ---------------------------------- | --------- | ------------------------------------------------------- |
| [`openai.json`](openai.json)       | OpenAI    | `{ type, function: { name, description, parameters } }` |
| [`anthropic.json`](anthropic.json) | Anthropic | `{ name, description, input_schema }`                   |
| [`prompt.md`](prompt.md)           | -         | Readable source of the shared tool description prompt   |

## Parameters

| Parameter | Type     | Required | Description                                                            |
| --------- | -------- | -------- | ---------------------------------------------------------------------- |
| `path`    | `string` | Yes      | Absolute path to the file                                              |
| `content` | `string` | Yes      | N34 edit body wrapping every unchanged block with `<<<<<<< SKIP` marks |
