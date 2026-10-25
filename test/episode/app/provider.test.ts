import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCredential, resolveProvider } from '../../../src/episode/app/provider.ts';
import type { ProviderPort } from '../../../src/episode/app/provider.ts';

const provider = (name: string, credentialEnvVar: string): ProviderPort => ({
  name, model: `${name}-model`, credentialEnvVar,
  acceptsReturnedModel: returned => returned === `${name}-model`,
  submit: async () => ({}),
});
const providers = { typesafe: provider('typesafe', 'TYPESAFE_API_KEY'), openrouter: provider('openrouter', 'OPENROUTER_API_KEY') };

test('defaults to the direct TypeSafe provider when JEV_PROVIDER is unset or blank', () => {
  assert.equal(resolveProvider(providers, {}).name, 'typesafe');
  assert.equal(resolveProvider(providers, { JEV_PROVIDER: '' }).name, 'typesafe');
  assert.equal(resolveProvider(providers, { JEV_PROVIDER: '   ' }).name, 'typesafe');
});

test('selects a registered provider by environment variable and rejects unknown values without echoing them', () => {
  assert.equal(resolveProvider(providers, { JEV_PROVIDER: 'openrouter' }).name, 'openrouter');
  assert.equal(resolveProvider(providers, { JEV_PROVIDER: ' openrouter ' }).name, 'openrouter');
  assert.throws(() => resolveProvider(providers, { JEV_PROVIDER: 'SECRET_PROVIDER_NAME' }), (error: unknown) => {
    const failure = error as { code: string; detail?: string };
    assert.equal(failure.code, 'unknown_provider');
    assert.equal(failure.detail, 'expected one of: openrouter, typesafe');
    assert.ok(!JSON.stringify(failure).includes('SECRET_PROVIDER_NAME'));
    return true;
  });
});

test('reads only the selected provider credential and rejects missing or header-invalid values', () => {
  assert.equal(readCredential(providers.typesafe, { TYPESAFE_API_KEY: 'key-1' }), 'key-1');
  assert.equal(readCredential(providers.openrouter, { TYPESAFE_API_KEY: 'key-1', OPENROUTER_API_KEY: 'key-2' }), 'key-2');
  for (const env of [{}, { TYPESAFE_API_KEY: '' }, { TYPESAFE_API_KEY: '  ' }]) {
    assert.throws(() => readCredential(providers.typesafe, env), { code: 'missing_credentials', detail: 'TYPESAFE_API_KEY' });
  }
  for (const value of ['key\ninjected', 'key with space', 'key\u0000']) {
    assert.throws(() => readCredential(providers.typesafe, { TYPESAFE_API_KEY: value }), { code: 'invalid_credentials', detail: 'TYPESAFE_API_KEY' });
  }
});
