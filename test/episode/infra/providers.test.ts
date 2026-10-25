import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EpisodeDriver } from '../support/episode-driver.ts';
import { INTERVENTION_OPTIONS, ISSUE_OPTIONS } from '../../../src/episode/domain/request.ts';

const choice = (options: readonly string[], selected: string) => ({
  type: 'choice', choice: selected,
  probabilities: Object.fromEntries(options.map(option => [option, option === selected ? 1 : 0])), confidence: 1,
});
const nativeResponse = (model = 'typesafe/jev-1.14-20261014') => ({
  model,
  answers: {
    intervention_kind: choice(INTERVENTION_OPTIONS, 'correction'),
    observable_issue: choice(ISSUE_OPTIONS, 'unsupported_completion_claim'),
  },
  usage: { input_tokens: 357, output_tokens: 38, cost: 0.000014994 },
});

test('production providers submit native Decisions bytes and preserve real model/usage metadata', async t => {
  for (const provider of ['openrouter', 'typesafe'] as const) {
    const episode = await EpisodeDriver.open(t);
    await episode.givenConversation(['Request', 'Done', 'Not what I asked']);
    const response = nativeResponse(provider === 'openrouter' ? undefined : 'jev-1.14.0');
    episode.givenProductionProviders(response);
    episode.givenEnvironment({ JEV_PROVIDER: provider, OPENROUTER_API_KEY: 'router-key', TYPESAFE_API_KEY: 'direct-key' });
    await episode.whenClassify();
    episode.thenClassifiedWith(provider, response.model);
    await episode.thenNativeSubmissionIs(provider);
    assert.deepEqual(episode.report!.usage, { inputTokens: 357, outputTokens: 38, costUsd: 0.000014994 });
    assert.deepEqual(episode.report!.answers.interventionKind, response.answers.intervention_kind);
    await episode.thenSourceIsUnchangedAndNoFilesWritten();
  }
});

test('production OpenRouter rejects router aliases and unrelated model identities without fallback', async t => {
  for (const model of ['typesafe/jev-router', 'openrouter/auto', 'openrouter/typesafe/jev-router', 'openrouter/fake-jev', 'typesafe/jev-1.13']) {
    const episode = await EpisodeDriver.open(t);
    await episode.givenConversation(['Request', 'Done', 'Wrong']);
    episode.givenProductionProviders(nativeResponse(model));
    episode.givenEnvironment({ JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' });
    await episode.whenClassify();
    episode.thenClassificationFails('model_mismatch');
    episode.thenHttpRequestCountIs(1);
  }
});

test('production OpenRouter rejects chat responses, malformed answers and absent or coerced usage', async t => {
  const native = nativeResponse();
  for (const response of [
    { model: native.model, choices: [{ message: { content: JSON.stringify(native) } }] },
    { ...native, answers: {} },
    { ...native, usage: undefined },
    { ...native, usage: { input_tokens: '357', output_tokens: 38 } },
  ]) {
    const episode = await EpisodeDriver.open(t);
    await episode.givenConversation(['Request', 'Done', 'Wrong']);
    episode.givenProductionProviders(response);
    episode.givenEnvironment({ JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' });
    await episode.whenClassify();
    episode.thenClassificationFails('invalid_response');
    episode.thenHttpRequestCountIs(1);
  }
});

test('production OpenRouter rejects invalid input before HTTP and does not retry a provider error', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Done', 'Wrong']);
  episode.givenProductionProviders({ error: { message: 'PRIVATE_PROVIDER_ERROR' } }, 400);
  episode.givenEnvironment({ JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' });
  await episode.whenClassify('native-0', 'missing');
  episode.thenClassificationFails('missing_boundary');
  episode.thenHttpRequestCountIs(0);
  await episode.whenClassify();
  episode.thenClassificationFails('http_error', 'HTTP 400');
  episode.thenHttpRequestCountIs(1);
});
