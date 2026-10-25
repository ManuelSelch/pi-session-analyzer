import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EpisodeDriver } from '../support/episode-driver.ts';
import { INTERVENTION_OPTIONS, ISSUE_OPTIONS } from '../../../src/episode/domain/request.ts';

const spread = (options: readonly string[], selected: string) =>
  Object.fromEntries(options.map(option => [option, option === selected ? 1 : 0]));
const answer = (options: readonly string[], choice: string) =>
  ({ type: 'choice', choice, probabilities: spread(options, choice), confidence: 0.9 });
const envelope = (model: string, kind = 'correction', issue = 'unsupported_completion_claim') => ({
  model,
  answers: { intervention_kind: answer(INTERVENTION_OPTIONS, kind), observable_issue: answer(ISSUE_OPTIONS, issue) },
  usage: { input_tokens: 120, output_tokens: 12, cost: 0.000019, rationale: 'SECRET_PROVIDER_TEXT' },
  id: 'SECRET_PROVIDER_ID',
});

test('submits the prepared request once and reports the validated classification', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Still wrong']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.14.0') });
  episode.givenEnvironment({ TYPESAFE_API_KEY: 'secret-key' });
  await episode.whenClassify();
  episode.thenSubmissionCountIs(1);
  await episode.thenSubmittedThePreparedRequest();
  episode.thenClassifiedWith('typesafe');
  episode.thenReportExcludes('SECRET_PROVIDER_TEXT');
  episode.thenReportExcludes('SECRET_PROVIDER_ID');
  assert.ok(episode.report);
  assert.equal(episode.report.answers.effectiveIssue, 'unsupported_completion_claim');
  assert.deepEqual(episode.report.answers.flags, []);
  assert.deepEqual(episode.report.usage, { inputTokens: 120, outputTokens: 12, costUsd: 0.000019 });
  assert.equal(episode.report.source.sessionId, 'session-1');
  assert.equal(episode.report.source.references.length, 3);
});

test('selects the provider profile from the environment and uses its own credential', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('openrouter', {
    model: 'typesafe/jev-1.14', credentialEnvVar: 'OPENROUTER_API_KEY',
    accepts: returned => returned === 'typesafe/jev-1.14' || returned === 'typesafe/jev-1.14-20260917',
    response: envelope('typesafe/jev-1.14-20260917'),
  });
  episode.givenEnvironment({ JEV_PROVIDER: 'openrouter', TYPESAFE_API_KEY: 'wrong-key', OPENROUTER_API_KEY: 'right-key' });
  await episode.whenClassify();
  episode.thenClassifiedWith('openrouter', 'typesafe/jev-1.14-20260917');
  await episode.thenSubmittedThePreparedRequest();
});

test('never submits for an unknown provider, missing credential or invalid episode', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.14.0') });
  episode.givenEnvironment({ JEV_PROVIDER: 'SECRET_PROVIDER_NAME', TYPESAFE_API_KEY: 'secret-key' });
  await episode.whenClassify();
  episode.thenClassificationFails('unknown_provider', 'expected one of: typesafe');
  episode.givenEnvironment({ TYPESAFE_API_KEY: '   ' });
  await episode.whenClassify();
  episode.thenClassificationFails('missing_credentials', 'TYPESAFE_API_KEY');
  episode.givenEnvironment({ TYPESAFE_API_KEY: 'secret-key' });
  await episode.whenClassify('native-0', 'native-1');
  episode.thenClassificationFails('intervention_not_user');
  episode.thenSubmissionCountIs(0);
});

test('reports invalid provider answers as failures without inventing a classification', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.13.0') });
  episode.givenEnvironment({ TYPESAFE_API_KEY: 'secret-key' });
  await episode.whenClassify();
  episode.thenClassificationFails('model_mismatch');
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: { model: 'jev-1.14.0', answers: {} } });
  await episode.whenClassify();
  episode.thenClassificationFails('invalid_response');
  episode.thenSubmissionCountIs(2);
});

test('fails before any submission when the episode cannot be prepared', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.14.0') });
  episode.givenEnvironment({ TYPESAFE_API_KEY: 'secret-key' });
  await episode.whenClassify('native-0', 'missing-entry');
  episode.thenClassificationFails('missing_boundary');
  episode.thenSubmissionCountIs(0);
});
