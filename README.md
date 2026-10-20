# Pi Session Analyzer

A planned local, read-only TypeScript CLI for agent-readable analysis of Pi sessions.

Initial focus: understand bash usage and tool-reported failures before deciding which workflows need specialized tools. Broader session and context metrics remain later work.

See [REQUIREMENTS.md](REQUIREMENTS.md) for scope and implementation slices. No CLI is implemented yet. The working name overlaps an existing public package; no publication is planned under this name without revisiting it.

## Development principles

- Keep the CLI thin; separate session reading, call/result extraction, and report aggregation into small modules.
- Prefer plain functions and data structures. Avoid frameworks, plugin systems, databases, and speculative abstractions.
- Read logs without executing recorded commands, starting an agent, or loading extensions.
- Test with synthetic fixtures; never commit personal transcripts or generated reports.
- Keep raw tool-reported failures separate from inferred failure reasons.
