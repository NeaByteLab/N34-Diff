# Contributing to N34 Diff

Thanks for stopping by. This document explains what kinds of contributions are welcome, where to file them, and the ground rules that keep this repo maintainable.

## Types of Contributions

### Documentation Improvements

Typo fixes, clearer phrasing, better examples, and additional guides for [`README.md`](./README.md) are all appreciated. Keep changes focused and preserve the existing tone.

### Bug Reports

Spotted a mis-applied edit, a mismatch between documented and actual behaviour, or a broken example? [Open an issue](https://github.com/NeaByteLab/N34-Diff/issues) with a minimal reproduction (a short `original` string, the `edit` body you fed in, and expected vs. actual `before`/`after`/`diff` goes a long way).

### Proposals, Questions, and Feedback

Want to suggest a new option, an API change, or discuss a design trade-off? [Start a discussion](https://github.com/NeaByteLab/N34-Diff/discussions) rather than opening an issue. Issues are reserved for concrete defects; Discussions are for ideas and open-ended exchange.

Ground your proposal in an actual problem you hit while applying edits or streaming LLM output. Every new option in the engine is a knob every consumer has to understand, so the bar for additions is intentionally high. When in doubt, leave it out.

> **Not sure where to post?** Default to Discussions. If it turns out to be a defect we can act on, we will convert it to an issue.

### Reference Engine (`src/`)

The engine under `src/` is intentionally small and opinionated. It aims to stay a pure text-to-text function with no runtime dependencies and no filesystem I/O. Refactors that keep the behaviour identical while improving readability, error messages, or type inference are welcome. Feature additions should be discussed first.

### What We Are Not Accepting Yet

To keep scope manageable during early iteration, the following are out of bounds for now:

- **Filesystem or network features** - N34 stays a pure text-to-text engine; I/O belongs in the consumer.
- **Alternative diff formats** - the engine targets one marker-based format (`<<<<<<< SKIP` framing); parallel formats are out of scope.
- **Sweeping architectural rewrites** - small, focused changes only.

If you are unsure whether something fits, open a Discussion before writing the code.

## Development Setup

The engine and tests run under Deno.

```bash
# Format, lint, and type-check the source
deno task check

# Run the test suite
deno task test
```

The npm distribution is produced with [unbuild](https://github.com/unjs/unbuild):

```bash
npm install
npm run build
```

## Submitting Changes

1. Fork the repository.
2. Create a branch off `main` for your work.
3. Make the change and verify it locally with `deno task check` and `deno task test`.
4. Open a pull request against `main`, describing what changed and why.

Keep each pull request focused on one logical change. Link any related issues or discussions.

## AI-Assisted Contributions

Using an AI assistant (Claude, GPT, Copilot, agent frameworks, and so on) to help with a contribution is fine and often useful. Please disclose it in the pull request or issue description, along with a rough sense of how the tool was used (for example, "AI drafted the initial matcher refactor; I reviewed and rewrote the error paths").

An example disclosure line is enough:

> Parts of this PR were drafted with the help of Claude Code, then reviewed and edited manually.

Trivial fixes (typos, whitespace, dead links) do not need a disclosure.

Undisclosed AI-generated code makes review harder and wastes reviewer attention. Contributions that appear to skip disclosure may be closed without merge.

### What Helps a Review Go Smoothly

- **Clear disclosure** if AI assistance was involved.
- **Your own understanding** of every changed line - you should be able to answer questions about it.
- **A short rationale** explaining why the change is needed.
- **Tests or examples** demonstrating the new behaviour or the regression the change fixes.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE) for code, and [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) for documentation.
