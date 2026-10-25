# Episode Classification S2 — Design

## Overview
Expose the S1 preparation library as a single `episode classify` command that submits directly to Jev, with provider-specific endpoint, credential and model naming isolated behind a provider port. Selection, projection, rubric, payload limit and answer validation stay provider-independent. Real-provider evaluation remains S3: S2 uses synthetic sessions and mocked transport only.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| Root CLI | [`src/cli.ts`](../../src/cli.ts) | Changed | Dispatch episode commands before the existing bash argument parser; wire the production provider registry |
| `src/episode/app` | Proposed episode CLI | New | Parse episode-only arguments; reject unknown/duplicate/missing flags and bash-only options before any file read |
| `src/episode/app` | Proposed classification use case | New | Prepare once, select provider, resolve credentials, submit once, validate, assemble the allowlisted report |
| `src/episode/app` | Proposed provider port | New | Declare the Jev provider contract and provider registry/selection |
| `src/episode/app` | [`prepareEpisode`](../../src/episode/app/prepare.ts) | Reused | One read snapshot, exact serialized request, local references and hashes |
| `src/episode/infra` | Proposed System One adapter | New | One bounded HTTP implementation for the System One wire contract, configured per provider profile |
| `src/episode/domain` | Proposed answer validation and result policy | New | Validate envelope and Choice answers; derive effective issue and review flags without I/O |
| `src/episode/domain` | [Request/rubric builder](../../src/episode/domain/request.ts) | Reused | Own the rubric, criteria keys and request bytes; export existing option keys for validation without duplicating the taxonomy |

State lives for one invocation only. The composition root injects the provider registry; adapter tests inject fetch. These seams support the required offline tests, not a general LLM abstraction. Keep lowercase layer folders, mirrored tests and no new runtime dependencies.

## Runtime flow
1. **Root CLI** routes `episode classify <session.jsonl> --from <entry-id> --at <user-entry-id>` to the **episode CLI**, which validates arguments before reading anything. Episode help prints usage without submitting.
2. **Classification use case** calls **prepareEpisode** once. Invalid selection or oversized input stops before any transport call.
3. The **provider port** resolves the selected provider profile: base URL, credential environment variable, pinned model ID and accepted returned-model IDs.
4. The use case reads only that provider's credential from the supplied process environment. Missing, blank or header-invalid credentials fail locally.
5. The **System One adapter** submits the prepared request string unchanged, once, with the profile's URL, bearer header and pinned model. A **domain validator** checks the envelope and both independent answers; **result policy** retains validated raw answers, computes the effective issue and flags contradictions. Emit one live report.
6. Any failure emits a fixed, content-free diagnostic on stderr, no classification on stdout, and exit 1. Success emits one JSON document and exit 0; uncertainty is data, not a failed request.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| User → CLI | Bash commands only → additional `episode classify` command and episode help | Existing bash options, reports, offline behavior and exit codes remain unchanged; episode flags are invalid for bash and vice versa |
| Preparation → provider | Existing serialized request → reused verbatim | Keep schema version 1, `episode-rubric-v1` and the inclusive 24,000-byte request limit |
| Provider port → adapters | None → provider profile plus `submit(serializedRequest, signal)` returning an untrusted envelope, and an accepted-returned-model check | New internal contract; the same port must accommodate a provider with a different wire format without changing callers |
| Adapter → TypeSafe | None → `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`, model `jev-1.14.0` | Documented [System One](https://docs.typesafe.ai/api/system-one) / [Choice](https://docs.typesafe.ai/primitives/choice) contract |
| Adapter → OpenRouter | None → `POST https://openrouter.ai/api/v1/systemone`, `Authorization: Bearer $OPENROUTER_API_KEY`, model `typesafe/jev-1.14` | OpenRouter documents this as System One–compatible with the TypeSafe SDKs; a separate alpha Decisions endpoint exists and is not used initially |
| Provider response → domain | Untrusted JSON → validated model, named Choice answers and usage | No coercion, renormalization or invented answers; unknown extension fields are ignored and never echoed |

**Provider differences:** Because both endpoints speak the same System One request/response shape, one bounded HTTP implementation parameterized by provider profile is sufficient for the two adapters; duplicating the transport per provider would be unjustified. A provider whose wire format differs gets its own adapter implementing the same port. Provider profiles own URL, credential variable, pinned model and returned-model matching, so switching providers cannot change the rubric or validation semantics.

**Output:** One JSON document with schema/rubric versions, `provider`, requested and returned model IDs, local source/session identity, `from`/`at`, native entry/line references, parser/projection warnings, snapshot hash, request hash, payload bytes, both validated answers (`type`, `choice`, full `probabilities`, `confidence`), `effectiveIssue`, review flags, token usage, optional provider-reported cost, elapsed request milliseconds and `reviewRequired: true`. Build output through an allowlist, never by spreading the prepared request or raw provider object.

**Answer validation:** Require the returned model to be accepted by the selected provider profile; require exactly the two expected answer IDs with `type: choice`. Probability maps must contain exactly their rubric's option keys, and `choice` must be one of them. Probabilities and confidence must be finite numbers in [0, 1]. Probability totals must differ from 1 by at most `0.000001`; the selected probability must be within `0.000000001` of the maximum, allowing ties. Preserve received numbers. Require nonnegative safe-integer token counts; do not equate confidence with selected probability or claim calibration.

**Result policy:** For `correction`, retain the raw issue as effective, including `insufficient_evidence`; otherwise the effective issue is `not_applicable`. Flag correction + `not_applicable`, or any non-correction + a concrete issue, as contradictory. A raw insufficient-evidence answer gets an uncertainty flag, not an invented reconciliation. All results require review regardless of confidence.

## Decisions & Trade-offs
- Submitting is the command's purpose, so no preview, confirmation or `--allow-network` flag exists; the user explicitly declined a preview step and accepted that unredacted episode evidence leaves the machine. The trade-off is real: a mistaken invocation cannot be reviewed locally first, and the request hash is only useful after the fact. Provider selection must therefore be explicit rather than inferred from environment credentials (see Open Questions).
- Use a fixed **30-second total HTTP deadline**, including response-body consumption, and a **65,536-byte response limit**; abort/cancel on timeout or excess size. Use `redirect: manual` and reject every redirect, including same-origin. No retries, model discovery, fallback model or additional evidence fetches. Reject non-2xx responses without reading or echoing their body, and parse successful bounded bodies as JSON before validation.
- Use fixed diagnostics such as unknown provider, missing credentials, timeout, HTTP status, invalid response and model mismatch. Never print arbitrary exception messages, provider bodies, headers, request content or supplied argument values. This also prevents accidental credential disclosure through invalid-option errors; existing bash diagnostics need no unrelated rewrite.
- Credentials are read only from the selected provider's environment variable and never from arguments or repository files. Live output excludes transcript text, request bodies and provider extension fields; no report or cache is written automatically.
- Include provider-reported cost only when the response supplies a finite, nonnegative number; otherwise omit the field rather than substituting an estimate.
- A run prepares its own current snapshot, so evidence changed since a previous run is transmitted as it exists now. Record both the snapshot hash and the request hash so out-of-range changes are distinguishable. Hash-lock or replay flags are outside S2.
- Mocked tests verify plumbing only, not provider availability or classification quality. No paid call occurs while designing or implementing S2.

## Verification
- Domain unit tests cover missing/extra answer or option keys, invalid types/ranges/totals, ties and inconsistent winners, unaccepted returned model, unsafe token counts, preserved probabilities and every effective-issue/contradiction combination.
- Use-case tests with a submission spy verify exactly one call with the prepared bytes, correct provider profile selection, credential resolution per provider, and zero calls for invalid input or missing credentials. Test fixed diagnostics and allowlisted output against malicious provider extension fields and error strings.
- Adapter tests with mocked fetch verify exact URL, headers, pinned model and body per provider profile, no redirect following or retry, HTTP/network failures, malformed or oversized bodies, deadline while waiting for headers and while consuming a stalled stream, cancellation and resource cleanup. Use short injected test deadlines rather than slow real waits.
- A test-only integration driver owns synthetic native JSONL fixtures, CLI child processes, fake credentials, network tripwires and cleanup. Check report JSON, hash/body fidelity, strict flags and help, source integrity, failure stdout/stderr/exit codes, and unchanged offline bash behavior. Use an in-process CLI runner with an injected registry for successful classification tests; do not add a user-configurable endpoint.
- Run every existing/new test and typecheck. No personal transcript fixtures, credentials or provider calls; real-session semantic validation remains S3.

## Open Questions
1. Is the provider chosen with an explicit `--provider` flag (recommended, so evidence cannot be silently routed to an unintended provider) or inferred from whichever provider credential is present in the environment?
