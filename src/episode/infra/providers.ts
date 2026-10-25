import type { ProviderPort } from '../app/provider.ts';
import { createSystemOneProvider, versionedModel } from './systemone.ts';

export const TYPESAFE_MODEL = 'jev-1.14.0';
// Native Jev Decisions, not Jev Router (which delegates to generative models).
export const OPENROUTER_MODEL = 'typesafe/jev-1.14';

// The native Decisions envelope shares System One's wire shape.
export function createProviders(options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Record<string, ProviderPort> {
  return {
    typesafe: createSystemOneProvider({
      name: 'typesafe', model: TYPESAFE_MODEL, url: 'https://api.typesafe.ai/v1/systemone',
      credentialEnvVar: 'TYPESAFE_API_KEY', acceptsReturnedModel: versionedModel(TYPESAFE_MODEL),
    }, options),
    openrouter: createSystemOneProvider({
      name: 'openrouter', model: OPENROUTER_MODEL, url: 'https://openrouter.ai/api/alpha/decisions',
      credentialEnvVar: 'OPENROUTER_API_KEY', acceptsReturnedModel: versionedModel(OPENROUTER_MODEL),
    }, options),
  };
}
