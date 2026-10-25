# S3 Live Validation

This is the private, one-off validation step for the Jev episode-classification feature.

## Scope
- Validate one explicitly selected real Pi session/episode end to end.
- Keep the source file and the selected entry IDs local.
- Do not add any automatic network/upload workflow, benchmarking, or batch-processing behavior.
- Keep all semantic findings private and separate from synthetic automated tests.

## Required preconditions
- The user has explicitly approved a single live validation run.
- The session path is a real local Pi JSONL file.
- The selected episode is bounded by explicit `--from` and `--at` entry IDs.
- The matching provider credential is present in the environment:
  - `TYPESAFE_API_KEY` for `typesafe`
  - `OPENROUTER_API_KEY` for `openrouter`
- `JEV_PROVIDER` is set to the intended provider or left unset to use the default `typesafe`.

## Recommended command

```sh
JEV_PROVIDER=typesafe TYPESAFE_API_KEY=... \
  node src/cli.ts episode classify /path/to/session.jsonl \
  --from 8fca4ad9 --at c3365bde
```

If the provider is OpenRouter (native Jev `typesafe/jev-1.14` via `/api/alpha/decisions`, not Jev Router; no TypeSafe key required):

```sh
JEV_PROVIDER=openrouter OPENROUTER_API_KEY=... \
  node src/cli.ts episode classify /path/to/session.jsonl \
  --from 8fca4ad9 --at c3365bde
```

## Safety rules
- Do not copy the transcript into tracked fixtures.
- Do not write any report/cache automatically.
- Do not send any session other than the chosen episode.
- Do not treat the result as a benchmark or a calibrated accuracy claim.
- Do not expand into automatic boundary detection or prevention recommendations.
- If credentials are unavailable, stop with the fixed provider/credential diagnostic and note the live-validation blocker.

## What to record privately
- provider and model used
- elapsed time and token usage
- source file path and selected entry IDs
- returned labels and probabilities
- whether the result agrees with the manual review
- any projection warnings or local parser warnings

## What not to do
- Do not upload multiple sessions.
- Do not store raw transcript text in the repository.
- Do not claim the model is accurate based on a single pilot episode.
- Do not treat the live run as proof of the underlying semantics without separate review.
