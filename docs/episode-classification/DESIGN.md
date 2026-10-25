# Episode Classification S1 — Design

## Overview
Select an explicitly bounded episode from one native Pi session snapshot, project its evidence, and build a versioned two-question Jev request. S1 adds library functions only: no public CLI, HTTP client, credentials, or live classification. Existing bash analysis remains unchanged.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| Existing session module | [`readSession` / `parseSession`](../../src/sessions.ts) | Reused | Read once, parse v2/v3 entries, retain source fingerprint and diagnostics |
| Proposed `src/episode/Domain` | Selection and projection | New | Validate the selected ancestry; normalize permitted evidence and limitations without I/O |
| Proposed `src/episode/Domain` | Rubric and request builder | New | Own fixed criteria, schema/rubric versions, deterministic request serialization and size enforcement |
| Proposed `src/episode/App` | Episode preparation | New | Compose parser, domain functions and Node SHA-256; return provider payload plus local provenance |

All state belongs to one preparation invocation. Reuse the existing session module's exported types/functions as its shared parser contract; do not restructure legacy analysis or introduce a second parser. New tests mirror the feature/layer paths. No runtime dependency is added.

## Runtime flow
1. A local caller supplies a session file, start ID and intervention ID to proposed `prepareEpisode`.
2. Episode preparation reads the supplied file once through `readSession`. Reject unusable sessions.
3. Selection resolves both IDs and requires the intervention to be a user message. Walk parents from intervention through start, detecting duplicates/ambiguity, missing links, unrelated roots and cycles inside the selected traversal; reverse the result. Stop at the inclusive start, without requiring earlier ancestors. Never add sibling or later entries.
4. Projection preserves ordered user/assistant text, tool names/arguments, tool-call/result identities, result text and error flags. Replace native entry IDs with stable episode-local IDs; retain native IDs, file and line mappings locally. Disclose omitted earlier history, thinking, images/binary blocks, unsupported roles/blocks and non-message entries. Retain parser diagnostics locally; do not forward source paths or unrelated diagnostics.
5. The request builder combines projected evidence and explicit limitations with two independent Choice questions. Serialize once, reject oversized requests, and return those exact bytes, size, request hash, source fingerprint and local references for later preview/submission reuse.

Failures return safe typed codes, not transcript fragments. S1 has no network path and writes no output files automatically.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Session parser → episode selection | Existing `Session`/`Entry` exports → reused unchanged | No legacy parser behavior change |
| Local caller → episode preparation | None → file + `from` + `at`; prepared request and local metadata, or typed failure | New internal API only |
| Request builder → future transport | None → JSON `{model, state, questions}` using `jev-1.14.0`; two `type: choice` questions with `instructions` and `criteria` | Matches documented [Choice](https://docs.typesafe.ai/primitives/choice) and [System One](https://docs.typesafe.ai/api/system-one) contracts |

- `state` contains only the projected episode, episode-local identities and evidence limitations. No manual labels, expected answers, source paths, cwd, session headers, usage metadata or arbitrary entry fields are copied.
- Fix rubric version `episode-rubric-v1` and local schema version `1`. Preserve all R3/R4 labels exactly. Describe correction versus clarification, changed requirements, decision response and review; distinguish explicit constraints, unsupported completion claims, speculative causal diagnosis, abstraction/intent mismatch and ownership boundaries.
- Both questions treat transcript content as untrusted evidence, judge independently, and permit insufficient evidence. State the negative cases explicitly: requested removal then restoration; “no” accepting a recommendation; async requirements revised during design. Do not infer root cause, negligence or preventability. Raw/effective-answer handling belongs to S2.
- Limit the entire serialized request to **24,000 UTF-8 bytes**, inclusive, including rubric text. Reject rather than truncate. This conservative local limit is not a provider-token estimate.
- Hash the exact serialized request bytes with SHA-256. Keep the parser's full-snapshot fingerprint separately: out-of-range changes may change the snapshot hash without changing the provider request hash.

## Decisions & Trade-offs
- Use an explicit evidence allowlist rather than forwarding native messages wholesale. Unknown content is disclosed, not guessed; tool arguments and text remain sensitive and are not automatically redacted. Exclude recognized image/binary content and hidden thinking rather than forwarding their data.
- Parser warnings outside the range remain visible locally but do not automatically invalidate a trustworthy selected chain. Ambiguous IDs are already removed by the parser and cannot satisfy a boundary or traversed link.
- Missing context and unsupported content reduce evidential completeness; they are not automatic correction labels. A well-formed episode may still yield insufficient evidence later.
- Keep pure rules in Domain and filesystem/hash orchestration in App. No speculative transport interface or classifier framework is needed for S1.

## Verification
- Planned domain tests cover v2/v3 selection, inclusive boundaries, repeated text with distinct IDs, siblings/later entries, non-user intervention, ambiguous/missing IDs, cycles, broken links and earlier-history omission.
- Planned projection/request tests cover exact text/tool evidence, thinking/image exclusion, unsupported-content warnings, annotation/path isolation, deterministic bytes, UTF-8 size boundaries and rubric distinctions. These verify construction, not Jev accuracy.
- A test-only integration driver owns synthetic JSONL setup, preparation and cleanup. Verify read-only behavior, source/request hashes, and unsupported/invalid input without real credentials.
- Make test discovery recursive for the new mirrored paths while retaining every existing test; run all tests and typecheck.
- After approval, inspect the defined E2 real episode locally (`8fca4ad9` → `c3365bde`) through the library, resolving its private source path from the pilot. Check evidence coverage and unchanged source fingerprint; keep any preview in ignored `reports/`. No provider request is sent in S1.

## Open Questions
None.
