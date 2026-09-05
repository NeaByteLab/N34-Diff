Apply a file text edit using N34 SKIP-marker diff format.

# Format

The "content" argument contains one or more edit blocks separated by `<<<<<<< SKIP` markers on their own line.

## Single Edit

Write the changed lines directly:

```
{changed_lines}
```

## Multiple edits in one call

Write each edit block back-to-back with exactly one `<<<<<<< SKIP` marker between adjacent edits, and no marker at the start or end of the content:

```
{edit_1_lines}
<<<<<<< SKIP
{edit_2_lines}
<<<<<<< SKIP
{edit_3_lines}
```

# Rules

- For a single edit, write the changed lines directly with no `<<<<<<< SKIP` marker.
- For multiple edits, place exactly one `<<<<<<< SKIP` marker between edits, never at start or end.
- Include enough context in each edit block so the engine anchors the change unambiguously.
- For deletions, keep context before and after the removed lines and omit the deleted lines.
- Preserve the original indentation character-for-character in every edit block.
- Send all edits to the engine in a single apply_edit call within one content string.
- Do NOT wrap content in code fences, backticks, or quotes, send raw text with no framing.

# Examples

Single change:

```
function add(a, b) {
  return a + b
}
```

Multi change (two edits in one file):

```
function add(a, b) {
  return a + b
}
<<<<<<< SKIP
function sub(a, b) {
  return a - b
}
```

Multi change (three edits in one file):

```
function add(a, b) {
  return a + b
}
<<<<<<< SKIP
function sub(a, b) {
  return a - b
}
<<<<<<< SKIP
function mul(a, b) {
  return a * b
}
```
