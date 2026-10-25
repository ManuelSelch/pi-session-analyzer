# Episode Classification S2 — Design

## Overview
Expose the existing S1 preparation library through a preview-first CLI. Add one explicitly authorized TypeSafe request and strict response validation; do not change episode selection, projection, rubric or payload limits. Real-provider evaluation remains S3: S2 uses synthetic sessions and mocked HTTP only.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| Root CLI | [`src/cli.ts`](../../src/cli.ts) | Changed | Dispatch episode commands before the existing bash argument parser; wire production transport |
| `src/episode/app` | Proposed episode CLI and classification use case | New | Parse episode-only arguments, prepare once, gate submission, assemble output and safe diagnostics |
| `src/episode/app` | [`prepareEpisode`](../../src/episode/app/prepare.ts) | Reused | One read snapshot, exact serialized request, local references and hashes |
| `src/episode/infra` | Proposed TypeSafe adapter | New | Built-in fetch, fixed endpoint, bearer authentication, deadline and bounded response reading |
| `src/episode/domain` | Proposed response validator and result policy | New | Validate Choice answers; derive effective issue and review flags without I/O |
| `src/episode/domain` | [Request/rubric builder](../../src/episode/domain/request.ts) | Reused | Own the model, criteria keys and request bytes; export existing option keys for response validation without duplicating the taxonomy |

State lives for one invocation only. The composition root injects a submission function into the use case; adapter tests inject fetch. These seams support required offline tests, not a provider framework. Keep lowercase layer folders, mirrored tests and no new runtime dependencies.

## Runtime flow
1. **Root CLI** routes `episode classify <session.jsonl> --from <entry-id> --at <user-entry-id> [--allow-network]` to the **episode CLI**. Reject missing/empty boundaries, duplicate options, unknown flags, extra positionals and bash-only flags before reading a file. Episode help never submits.
2. **Classification use case** calls **prepareEpisode** once. Invalid selection or oversized input stops before any transport call.
3. Without `--allow-network`, return a preview containing the exact request body and provenance. Do not read credentials or call transport, even if an API key exists.
4. With explicit opt-in, read only `TYPESAFE_API_KEY` from the supplied process environment. Missing, blank or header-invalid credentials fail locally. **TypeSafe adapter** submits the prepared string unchanged, once.
5. **Response validator** checks the returned envelope and both independent answers. **Result policy** retains validated raw answers, computes the effective issue and flags contradictions. Emit a live report without request text or rationale.
6. Every episode failure emits a fixed, content-free diagnostic on stderr, no stdout classification, and exit 1. Successful preview/live output is one JSON document and exit 0; uncertainty is data, not a failed request.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| User → CLI | Bash commands only → additional episode command and episode help | Existing bash options, reports, offline behavior and exit codes remain unchanged; network flag is invalid for bash |
| Preparation → preview/adapter | Existing serialized request → reused verbatim | Keep `jev-1.14.0`, `episode-rubric-v1`, schema version 1 and the inclusive 24,000-byte request limit |
| Adapter → TypeSafe | None → `POST https://api.typesafe.ai/v1/systemone`, JSON body, `Authorization: Bearer …` | Direct documented [System One](https://docs.typesafe.ai/api/system-one) / [Choice](https://docs.typesafe.ai/primitives/choice) contract; no SDK defaults or retries |
| Provider response → domain | Untrusted JSON → validated model, named Choice answers and usage | No coercion, renormalization or invented answers; unknown extension fields are ignored and never echoed |

**Output:** Both modes include schema/rubric versions, local source/session identity, `from`/`at`, native entry/line references, parser/projection warnings, snapshot hash, request hash, payload bytes and requested model. Preview adds `mode: preview`, `sensitiveEvidence: true` and `requestBody` containing the exact serialized JSON string. Live adds `mode: live`, returned model, both validated answers (`type`, `choice`, full `probabilities`, `confidence`), `effectiveIssue`, review flags, token usage, elapsed request milliseconds and `reviewRequired: true`. Build live output through an allowlist, never by spreading the prepared request or raw provider object.

**Response validation:** Require returned model to equal the pinned requested ID; require exactly the two expected answer IDs and `type: choice`. Probability maps must contain exactly their rubric's option keys; choice must be one of those keys. Probabilities and confidence must be finite numbers in [0, 1]. Probability totals must differ from 1 by at most `0.000001`; selected probability must be within `0.000000001` of the maximum, allowing ties. Preserve received numbers. Require nonnegative safe-integer `input_tokens` / `output_tokens`; do not equate confidence with selected probability or claim calibration.

**Result policy:** For `correction`, retain the raw issue as effective, including `insufficient_evidence`; otherwise effective issue is `not_applicable`. Flag correction + `not_applicable`, or any non-correction + a concrete issue, as contradictory. A raw insufficient-evidence answer gets an uncertainty flag, not an invented reconciliation. All results require review regardless of confidence.

## Decisions & Trade-offs
- Use fixed **30-second total HTTP deadline**, including response-body consumption, and **65,536-byte response limit**. Abort/cancel on timeout or excess size. Measure elapsed time monotonically from submission through body consumption; no timers/resources remain after completion. No CLI tuning flags yet.
- Use `redirect: manual` and reject every redirect, including same-origin ones. No retries, model discovery, fallback model or additional evidence fetches. Reject non-2xx responses without reading/echoing their body; parse successful bounded bodies as JSON and validate them before reporting success.
- Use fixed diagnostics such as missing credentials, timeout, HTTP status, invalid response and model mismatch. Never print arbitrary exception messages, provider bodies, headers, request content or supplied argument values. This also prevents accidental credential disclosure through invalid-option errors. Existing bash diagnostics need no unrelated rewrite.
- Preview deliberately reveals sensitive evidence; it is not secret-redacted. Source-file metadata stays local, while paths embedded in transcript evidence remain. Live output excludes transcript and provider extension fields. No report/cache is written automatically.
- A live invocation prepares its own current snapshot; it does not replay a previous preview. Users must re-preview changed evidence. Record both hashes so out-of-range source changes can alter the snapshot hash without changing the transmitted request hash. Hash-lock/replay flags are outside S2.
- Documentation currently lists the pinned model and response contract. S2 mocked tests verify plumbing only, not provider availability or classification quality. No paid call occurs while designing or implementing S2.

## Verification
- Domain unit tests cover missing/extra answer or option keys, invalid types/ranges/totals, ties and inconsistent winners, model mismatch, unsafe token counts, preserved probabilities and every effective-issue/contradiction combination.
- Use-case tests with a submission spy verify zero calls for preview, invalid input and missing credentials; exactly one call in live mode with the prepared bytes. Test fixed diagnostics and allowlisted live output against malicious provider extension fields and error strings.
- Adapter tests with mocked fetch verify exact endpoint/headers/body, no redirect following or retry, HTTP/network failures, malformed/oversized bodies, deadline while waiting for headers or consuming a stalled stream, cancellation and resource cleanup. Use short injected test deadlines rather than slow real waits.
- A test-only integration driver owns synthetic native JSONL fixtures, CLI child processes, fake credentials, network tripwires and cleanup. Check preview JSON/hash/body fidelity, strict flags/help, source integrity, failure stdout/stderr/exit codes, and unchanged offline bash behavior. Use an in-process CLI runner with injected transport for successful live-output tests; do not add a user-configurable endpoint for tests.
- Run every existing/new test and typecheck. No personal transcript fixtures, credentials or provider calls; real-session semantic validation remains S3.

## Open Questions
None.
