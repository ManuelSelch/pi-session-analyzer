import { EpisodeError } from '../domain/errors.ts';

// Jev-only provider boundary: adapters own endpoint, credential, model naming and
// transport, while the rubric and answer validation stay provider-independent.
export interface ProviderPort {
  readonly name: string;
  readonly model: string;
  readonly credentialEnvVar: string;
  acceptsReturnedModel(returnedModel: string): boolean;
  submit(serializedRequest: string, credential: string): Promise<unknown>;
}

export const DEFAULT_PROVIDER = 'typesafe';
const headerSafe = /^[\x21-\x7e]+$/;

export function resolveProvider(providers: Record<string, ProviderPort>,
  env: Record<string, string | undefined>): ProviderPort {
  const requested = env.JEV_PROVIDER?.trim();
  const name = requested ? requested : DEFAULT_PROVIDER;
  const provider = providers[name];
  if (!provider) {
    // Never echo the supplied value; only the fixed set of known providers.
    throw new EpisodeError('unknown_provider', `expected one of: ${Object.keys(providers).sort().join(', ')}`);
  }
  return provider;
}

export function readCredential(provider: ProviderPort, env: Record<string, string | undefined>): string {
  const value = env[provider.credentialEnvVar];
  if (value === undefined || value.trim() === '') throw new EpisodeError('missing_credentials', provider.credentialEnvVar);
  // Header-invalid values are rejected locally instead of being sent or echoed.
  if (!headerSafe.test(value)) throw new EpisodeError('invalid_credentials', provider.credentialEnvVar);
  return value;
}
