# OpenRouter Jev Decisions Repair — Design

## Overview
Replace the mistakenly added chat-completions path with OpenRouter's documented native Decisions endpoint. Jev Router delegates generation to other models and does not meet this feature's Jev-only Choice contract. The current adapter also incorrectly trusts generated text for model identity and usage; relaxing model validation would conceal that defect.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| Episode infra | [Provider profiles](../../../src/episode/infra/providers.ts) | Changed | Pin OpenRouter to `typesafe/jev-1.14` and `/api/alpha/decisions`; remove speculative model aliases |
| Episode infra | [System One transport](../../../src/episode/infra/systemone.ts) | Changed | Remove chat wrapping/normalization; submit native decision JSON once with existing bounded HTTP handling |
| Episode app/domain | [Preparation](../../../src/episode/app/prepare.ts), [request builder](../../../src/episode/domain/request.ts) | Changed | Prepare for the resolved provider model so request bytes, size and hash describe the actual submission |
| Episode domain | [Answer validator](../../../src/episode/domain/answers.ts) | Reused | Validate native answers, reported usage and versioned model identity without coercion |

State remains invocation-local. No dependencies or new user flags.

## Runtime flow
1. CLI validates arguments; classification resolves the provider profile.
2. Preparation reads one snapshot and serializes the rubric/evidence with that provider's pinned model.
3. Transport sends those exact bytes to the selected endpoint using only its credential.
4. Domain validation checks the native response envelope and emits the existing allowlisted report. Failure remains a content-free diagnostic; there is no retry or router fallback.

## Contracts & API changes
| Boundary | Current → proposed | Compatibility |
|---|---|---|
| OpenRouter request | Chat messages to `typesafe/jev-router` → native `state`/`questions` to `POST https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.14` | Restores Jev-only behavior; OpenRouter key only |
| OpenRouter response | Generated JSON metadata → native envelope model, probabilities and token counts | Never fabricate usage or replace returned model identity |
| Preparation | Fixed direct-provider model → optional explicit model, direct default preserved | Hash and byte count cover actual transmitted request |

TypeSafe endpoint, CLI flags, output fields, strict model-version matching, deadlines, body limits and offline bash commands remain unchanged.

## Decisions & Trade-offs
- Use the [official OpenRouter Jev guide](https://openrouter.ai/blog/insights/what-is-jev/), which documents native Decisions HTTP and TypeScript SDK examples. A chat-model listing is not proof that decision models are unavailable.
- Preserve real probability distributions instead of asking a generative model to invent them.
- Documentation verifies the contract, not availability for this user's account. No live success is claimed without a successful response.

## Verification
- Add a failing regression through the production registry asserting endpoint, pinned body model, exact prepared bytes/hash, native dated returned model and actual usage.
- Reject router/unrelated models, malformed native answers and missing usage; retain existing HTTP/privacy regressions.
- Run all tests and typecheck. A live demo can follow with an environment-provided OpenRouter key; no credential or transcript logging.

## Open Questions
None.
