import type { ProviderPort } from '../app/provider.ts';
import { createSystemOneProvider, versionedModel } from './systemone.ts';

export const TYPESAFE_MODEL = 'jev-1.14.0';
export const OPENROUTER_MODEL = 'typesafe/jev-1.14';

// Both providers expose the same System One wire contract, so one bounded HTTP
// implementation is configured per profile instead of duplicated.
export function createProviders(options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Record<string, ProviderPort> {
  return {
    typesafe: createSystemOneProvider({
      name: 'typesafe', model: TYPESAFE_MODEL, url: 'https://api.typesafe.ai/v1/systemone',
      credentialEnvVar: 'TYPESAFE_API_KEY', acceptsReturnedModel: versionedModel(TYPESAFE_MODEL),
    }, options),
    openrouter: createSystemOneProvider({
      name: 'openrouter', model: OPENROUTER_MODEL, url: 'https://openrouter.ai/api/v1/systemone',
      credentialEnvVar: 'OPENROUTER_API_KEY', acceptsReturnedModel: versionedModel(OPENROUTER_MODEL),
    }, options),
  };
}
