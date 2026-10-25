import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EpisodeDriver } from '../support/episode-driver.ts';
import { runEpisodeCommand } from '../../../src/episode/app/cli.ts';
import { INTERVENTION_OPTIONS, ISSUE_OPTIONS } from '../../../src/episode/domain/request.ts';

const cli = resolve('src/cli.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const spread = (options: readonly string[], selected: string) =>
  Object.fromEntries(options.map(option => [option, option === selected ? 1 : 0]));
const envelope = (model: string) => ({
  model,
  answers: {
    intervention_kind: { type: 'choice', choice: 'correction', probabilities: spread(INTERVENTION_OPTIONS, 'correction'), confidence: 0.9 },
    observable_issue: { type: 'choice', choice: 'unsupported_completion_claim', probabilities: spread(ISSUE_OPTIONS, 'unsupported_completion_claim'), confidence: 0.8 },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
});

test('classifies in process and writes JSON to stdout with one provider notice on stderr', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Still wrong']);
  episode.givenProvider('openrouter', { model: 'typesafe/jev-1.14', credentialEnvVar: 'OPENROUTER_API_KEY', response: envelope('typesafe/jev-1.14') });
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEpisodeCommand(['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2'], {
    providers: episode.registry,
    env: { JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'secret-key' },
    stdout: text => out.push(text),
    stderr: text => err.push(text),
  });
  assert.equal(code, 0);
  assert.deepEqual(err, ['provider=openrouter model=typesafe/jev-1.14\n']);
  const report = JSON.parse(out.join(''));
  assert.equal(report.provider, 'openrouter');
  assert.equal(report.reviewRequired, true);
  assert.equal(report.answers.interventionKind.choice, 'correction');
  assert.ok(!out.join('').includes('secret-key'));
  assert.equal(report.source.references[0].entryId, 'native-0');
});

test('supports text and explicit JSON formats without changing the classification request', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['PRIVATE_REQUEST', 'PRIVATE_CLAIM', 'PRIVATE_CORRECTION']);
  episode.givenProvider('openrouter', { model: 'typesafe/jev-1.14', credentialEnvVar: 'OPENROUTER_API_KEY', response: envelope('typesafe/jev-1.14') });
  for (const format of ['text', 'json']) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEpisodeCommand(['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2', '--format', format], {
      providers: episode.registry, env: { JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'secret-key' },
      stdout: value => out.push(value), stderr: value => err.push(value),
    });
    assert.equal(code, 0);
    if (format === 'text') {
      assert.match(out.join(''), /Episode Analysis/);
      assert.match(out.join(''), /Unsupported completion claim/);
      assert.equal(err.join(''), '');
      assert.doesNotMatch(out.join(''), /openrouter|jev-1|PRIVATE_|secret-key|snapshotHash/);
    } else {
      assert.equal(JSON.parse(out.join('')).provider, 'openrouter');
      assert.deepEqual(err, ['provider=openrouter model=typesafe/jev-1.14\n']);
    }
  }
  assert.equal(episode.submissionCount, 2);
  episode.thenSubmittedRequestsAreIdentical();
});

test('rejects invalid, missing and duplicate formats before submission', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  for (const flags of [['--format'], ['--format', 'SECRET_FORMAT'], ['--format', 'text', '--format', 'json']]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEpisodeCommand(['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2', ...flags], {
      providers: {}, env: {}, stdout: value => out.push(value), stderr: value => err.push(value),
    });
    assert.equal(code, 1);
    assert.equal(out.join(''), '');
    assert.match(err.join(''), /^episode invalid_arguments/);
    assert.doesNotMatch(err.join(''), /SECRET_FORMAT/);
  }
  assert.equal(episode.submissionCount, 0);
});

test('text format preserves failure diagnostics and emits no partial report', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('wrong-model') });
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEpisodeCommand(['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2', '--format', 'text'], {
    providers: episode.registry, env: { TYPESAFE_API_KEY: 'key' }, stdout: value => out.push(value), stderr: value => err.push(value),
  });
  assert.equal(code, 1);
  assert.equal(out.join(''), '');
  assert.equal(err.join(''), 'episode model_mismatch\n');
});

test('prints usage for help and rejects malformed or unknown invocations without submitting', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.14.0') });
  const invoke = (args: string[], env: Record<string, string | undefined> = { TYPESAFE_API_KEY: 'secret-key' }) => {
    const out: string[] = [];
    const err: string[] = [];
    return runEpisodeCommand(args, { providers: episode.registry, env, stdout: text => out.push(text), stderr: text => err.push(text) })
      .then(code => ({ code, out: out.join(''), err: err.join('') }));
  };
  for (const args of [[], ['classify'], ['classify', episode.sessionFile], ['classify', episode.sessionFile, '--from', 'native-0'],
    ['classify', episode.sessionFile, '--at', 'native-2'], ['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2', '--provider', 'openrouter'],
    ['classify', episode.sessionFile, '--from', 'native-0', '--from', 'native-1', '--at', 'native-2'],
    ['classify', episode.sessionFile, 'extra', '--from', 'native-0', '--at', 'native-2'],
    ['classify', episode.sessionFile, '--from', '--at', 'native-2'],
    ['unknown', 'subcommand']]) {
    const result = await invoke(args);
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.out, '', args.join(' '));
    assert.match(result.err, /^episode /, args.join(' '));
  }
  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /episode classify/);
  assert.equal(help.err, '');
  assert.equal(episode.submissionCount, 0);
});

test('fails with fixed diagnostics for provider, credential and response problems', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  episode.givenProvider('typesafe', { model: 'jev-1.14.0', response: envelope('jev-1.13.0') });
  const invoke = (env: Record<string, string | undefined>) => {
    const err: string[] = [];
    return runEpisodeCommand(['classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2'],
      { providers: episode.registry, env, stdout: () => {}, stderr: text => err.push(text) })
      .then(code => ({ code, err: err.join('') }));
  };
  const unknown = await invoke({ JEV_PROVIDER: 'SECRET_PROVIDER_NAME' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown_provider/);
  assert.ok(!unknown.err.includes('SECRET_PROVIDER_NAME'));
  const missing = await invoke({});
  assert.equal(missing.code, 1);
  assert.match(missing.err, /missing_credentials/);
  const mismatch = await invoke({ TYPESAFE_API_KEY: 'secret-key' });
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.err, /model_mismatch/);
  assert.ok(!mismatch.err.includes('secret-key'));
  assert.equal(episode.submissionCount, 1);
});

test('exposes the episode command from the root CLI while bash stays offline', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Request', 'Claim', 'Correction']);
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /episode classify/);
  const missing = run('episode', 'classify', episode.sessionFile, '--from', 'native-0');
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^episode invalid_arguments/);
  const unknownProvider = spawnSync(process.execPath, [cli, 'episode', 'classify', episode.sessionFile, '--from', 'native-0', '--at', 'native-2'],
    { encoding: 'utf8', env: { ...process.env, JEV_PROVIDER: 'SECRET_PROVIDER_NAME' } });
  assert.equal(unknownProvider.status, 1);
  assert.equal(unknownProvider.stdout, '');
  assert.ok(!unknownProvider.stderr.includes('SECRET_PROVIDER_NAME'));
  const bash = run('bash', 'summary', '--root', episode.sessionFile);
  assert.equal(bash.status, 1);
  assert.match(bash.stderr, /ENOTDIR|not a directory/i);
});
