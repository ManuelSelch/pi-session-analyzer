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
- Runner wrappers are transparent: `npx`, `bunx`, `pnpx`, and `pnpm`/`yarn`/`bun` `exec` or `dlx` classify the wrapped executable. Direct `playwright` commands join the other test/build runners. Option-like wrapper arguments are skipped conservatively; only `-p`/`--package` consume a following value.
- Failure reasons: `missing_path`, `command_unavailable`, `syntax_or_options`, `repository_state`, `permissions`, `timeout`, `network_or_auth`, `test_or_build_failure`, `no_matches_possible`, `cancellation`, `unknown`. Non-error outcomes get `not_applicable`.
- Only explicit execution-cancellation lines count as possible cancellation, not words in test names or a zero-cancellation counter. A simple search command with an empty-output exit-one marker suggests possible no matches; exit one alone is not sufficient for other commands.
- `potentiallyAvoidableErrors` is a triage hypothesis for missing paths/executables, invalid syntax/options, and wrong Git repository state. Opportunities rank these counts first, not error percentage alone. Test/build failures can be expected during TDD; high usage or a nonzero exit is not itself an agent mistake. Output can contain misleading/quoted diagnostics; inspect examples before acting.
- Suspected retries are only identical commands whose next assistant entry directly follows that failed result on the same branch. They are explicitly **inferred**, can be intentional repetitions, and miss retries with intervening entries or changed arguments. No reliable retry-time or wasted-effort metric is claimed.
- Group shares and rates are fractions (0–1). `shareOfAllCalls` uses all observed assistant bash calls; `shareOfAllFailures` uses all matched tool-reported bash errors. Reasons partition errors; families partition all calls. Affected-project counts use known header cwd strings, not repository identity; unknown cwd sessions are reported separately.

## Episode classification

The [episode roadmap](docs/episode-classification/REQUIREMENTS.md) is separate from the legacy bash roadmap. Slices 1–2 are implemented: `prepareEpisode(file, from, at)` in [src/episode/app/prepare.ts](src/episode/app/prepare.ts) selects an inclusive ancestry-bounded episode from one v2/v3 file, projects evidence, and builds the exact two-Choice Jev request; `episode classify` submits it and validates the returned answers.

```sh
JEV_PROVIDER=openrouter OPENROUTER_API_KEY=... node src/cli.ts episode classify /path/to/session.jsonl \
  --from <start-entry-id> --at <user-intervention-entry-id>
```

- **Submitting is the command's purpose.** There is no preview mode and no extra confirmation flag: the selected episode evidence leaves the machine as-is. It is **not secret-redacted**, so choose episodes you are willing to send to the provider.
- **Provider:** `JEV_PROVIDER` selects `typesafe` (default, `TYPESAFE_API_KEY`, model `jev-1.14.0`) or `openrouter` (`OPENROUTER_API_KEY`, model `typesafe/jev-1.14`). An unknown value or missing credential fails before any request. The resolved provider and model are printed once on stderr and recorded in the output.
- **Only Jev answers.** Provider differences live behind one provider port; the rubric, payload limit and answer validation are provider-independent.
- **One request per invocation**, 30-second total deadline, no retries, redirects rejected, response capped at 65,536 bytes. Failures exit 1 with a fixed diagnostic on stderr and no JSON on stdout; success exits 0 with one JSON document.
- **Output** contains schema/rubric versions, provider, requested/returned model, local source references, warnings, snapshot/request hashes, both validated answers with full probabilities and confidence, `effectiveIssue`, contradiction/uncertainty flags, token usage, optional provider cost, elapsed time and `reviewRequired: true`. Probabilities are validated (option keys, ranges, totals, selected maximum) but never treated as calibrated accuracy.
- Requests exceeding **24,000 UTF-8 bytes**, including the rubric, are rejected without trimming. Source-file paths and native entry mappings stay local; paths already present in transcript text or tool arguments remain evidence. Thinking and recognized binary/image blocks are omitted with warnings.
- Existing bash commands remain offline and unchanged. Automated tests use synthetic fixtures and mocked transport only; no credentials, paid calls or personal transcripts are committed.
- S3 validation is intentionally a private, one-off live check: select the explicit episode from the local Pi session, run it with `JEV_PROVIDER` and the matching API key, and keep the result in `reports/` only if the user explicitly wants a local artifact. If either credential is unavailable, stop with the fixed "missing_credentials" diagnostic instead of pretending a validation ran.

See [docs/episode-classification/S3-VALIDATION.md](docs/episode-classification/S3-VALIDATION.md) for the live-validation checklist and private-session guardrails.

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
- `src/episode/domain/`: episode selection, evidence projection, request/rubric construction and answer validation.
- `src/episode/app/`: episode preparation, provider port and the classification use case and CLI.
- `src/episode/infra/`: bounded System One HTTP adapter and the TypeSafe/OpenRouter provider profiles.

Avoid frameworks, plugin systems, and speculative abstractions. Add a synthetic regression test before adjusting a rule based on private session evidence.
