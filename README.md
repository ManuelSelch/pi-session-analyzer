# Pi Session Analyzer

A small, local TypeScript CLI for agent-readable analysis of Pi session logs. **Slices 1 and 2 are implemented:** read-only bash inventory and conservative usage/failure classification. General session/context metrics are later work; see [REQUIREMENTS.md](REQUIREMENTS.md).

Requires **Node.js 24+**. No runtime dependencies, build step, model calls, extension loading, database, or network access. The working name overlaps an existing public package; this project is private and unpublished.

## Quick start

Run from the project directory:

```sh
node src/cli.ts bash summary
node src/cli.ts bash summary --root /path/to/sessions
node src/cli.ts bash calls /path/to/session.jsonl --failed
```

Both commands emit a single JSON document. Default root: `~/.pi/agent/sessions`. Recursive discovery includes pi-chat archived sessions, which remain in place. Directory symlinks and symlinked files are not followed.

**Exit codes:** `0` complete (including no sessions/calls), `2` partial report with structured warnings, `1` fatal read/invocation error (stderr, no JSON). A partial report is still useful: inspect `coverage` and `warnings` before interpreting it. Do not discard its JSON just because the process exited with 2.

For npm usage, `npm run --silent start -- bash summary` avoids npm banners on stdout.

## Agent investigation workflow

```sh
mkdir -p reports
node src/cli.ts bash summary > reports/baseline.json

# Choose a session path from sessions[] or a classification example's source.file.
node src/cli.ts bash calls /path/to/session.jsonl --failed --limit 20
node src/cli.ts bash calls /path/to/session.jsonl --family text_search --reason no_matches_possible

# Explicitly request sensitive evidence only when needed.
node src/cli.ts bash calls /path/to/session.jsonl --failed --include-content --limit 5
```

- `bash summary`: coverage, totals, per-session counts, ranked command families, likely failure reasons, and triage opportunities. Each group includes calls, completions, errors, error rate, share of all failures, affected sessions/projects, rule IDs, and at most three examples (errors first).
- `bash calls`: call metadata, result references, heuristic labels/rules, and narrowly inferred immediate retries. `--failed`, `--family`, and `--reason` combine as AND filters. Labels match summary labels exactly. `--limit` defaults to 50 (maximum 500), `--offset` defaults to 0. Pagination applies after filtering. Totals always describe the whole file, not the filtered page. Unmatched results have a separate total and use the same offset/limit independently.
- `--include-content`: allowed on either command. Adds command and result excerpts capped at 2,000 characters each, with truncation flags. These are **not redacted** and may contain secrets. Defaults never emit raw commands, prompts, thinking, or output. Paths, session IDs, and cwd metadata are still visible.
- `reports/` is Git-ignored. Keep saved reports private. Repeat the same command later and compare equivalent workloads manually; date/project filters and automated comparison are not implemented yet.

## Metric definitions

- Scope is **all persisted branches**, not just the current model context. Direct user shell executions are counted separately from assistant bash tool calls.
- A bash tool is `bash` or a dotted name ending in `.bash`. Calls and results match by tool-call ID and earlier parent ancestry within one session. IDs reused on independent branches can be resolved; ambiguous calls/results do not count as trusted completions.
- `errors` counts only matched results with `isError: true`. `errorRate = errors / completed`; no completions yields null with a reason. Missing/invalid outcome flags, unmatched calls, and ambiguous matches remain separate. Do not infer a tool error from text alone.
- Identical copies of one session count once. Conflicting copies of the same session ID are excluded with warnings. **Copied history across different fork session IDs is not deduplicated**, so counts need not agree exactly with pi-stats.
- Totals are observed counts, not estimates of data hidden by damage. `status: partial` means warnings occurred. Supported JSONL headers are v2 and v3; legacy v1 is explicitly skipped. Out-of-tree pi-chat title metadata is accepted. Malformed lines, unsupported logs, missing parents, and duplicate entry IDs produce content-free warnings with source locations.
- `coverage`: discovered files; parsed files (read successfully); usable files (supported headers, before copy selection); analyzed files (one per included session); skipped files (unreadable/unsupported/conflicting); duplicate files (identical copies excluded); conflicting files; distinct included sessions; partial files (usable files with parse/matching warnings, before copy selection). These are not all disjoint dimensions. Empty/headerless files are skipped, not invented sessions.
- Active logs can grow while scanning; the report is not an atomic snapshot. No source files are written or migrated.

## Classification limits

Rules are versioned separately (`classification.version`) from raw metrics (`metricDefinitionVersion`). Categories describe **heuristic evidence**, not established root causes or task success.

- Command families: `text_search`, `file_discovery`, `file_reading`, `file_operations`, `git`, `tests_builds`, `package_management`, `network`, `scripts`, `environment`, `shell_utilities`, `mixed`, `unknown`.
- The classifier inspects all supported unquoted shell segments. A quoted separator is text, not another command. Different purposes yield `mixed`; comments, heredocs, substitutions, control flow, and other opaque structures stay `unknown`. It is deliberately not a full shell parser.
- Failure reasons: `missing_path`, `command_unavailable`, `syntax_or_options`, `repository_state`, `permissions`, `timeout`, `network_or_auth`, `test_or_build_failure`, `no_matches_possible`, `cancellation`, `unknown`. Non-error outcomes get `not_applicable`.
- Only explicit execution-cancellation lines count as possible cancellation, not words in test names or a zero-cancellation counter. A simple search command with an empty-output exit-one marker suggests possible no matches; exit one alone is not sufficient for other commands.
- `potentiallyAvoidableErrors` is a triage hypothesis for missing paths/executables, invalid syntax/options, and wrong Git repository state. Opportunities rank these counts first, not error percentage alone. Test/build failures can be expected during TDD; high usage or a nonzero exit is not itself an agent mistake. Output can contain misleading/quoted diagnostics; inspect examples before acting.
- Suspected retries are only identical commands whose next assistant entry directly follows that failed result on the same branch. They are explicitly **inferred**, can be intentional repetitions, and miss retries with intervening entries or changed arguments. No reliable retry-time or wasted-effort metric is claimed.
- Group shares and rates are fractions (0–1). `shareOfAllCalls` uses all observed assistant bash calls; `shareOfAllFailures` uses all matched tool-reported bash errors. Reasons partition errors; families partition all calls. Affected-project counts use known header cwd strings, not repository identity; unknown cwd sessions are reported separately.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
```

Synthetic fixtures only; never commit personal transcripts or reports. Tests cover call/result matching, branches, malformed logs, duplicates, privacy, pagination, classification, and end-to-end JSON output.

Small modules, plain functions:

- `src/sessions.ts`: discovery and tolerant read-only parsing.
- `src/bash.ts`: bash extraction, ancestry matching, raw totals.
- `src/classify.ts`: versioned purpose/reason heuristics.
- `src/reports.ts`: bounded public reports and grouped metrics.
- `src/cli.ts`: argument handling and JSON/exit-code wiring.

Avoid frameworks, plugin systems, and speculative abstractions. Add a synthetic regression test before adjusting a rule based on private session evidence.
