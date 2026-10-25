import { validateResponse } from '../domain/answers.ts';
import type { ValidatedAnswers, ValidatedUsage } from '../domain/answers.ts';
import type { ProjectionWarning, SourceReference } from '../domain/project.ts';
import type { Warning } from '../../sessions.ts';
import { prepareEpisode } from './prepare.ts';
import { readCredential, resolveProvider } from './provider.ts';
import type { ProviderPort } from './provider.ts';

export interface ClassifyOptions {
  file: string;
  from: string;
  at: string;
  env: Record<string, string | undefined>;
  providers: Record<string, ProviderPort>;
  onProviderResolved?: (provider: ProviderPort) => void;
  now?: () => number;
}

export interface ClassifyReport {
  schemaVersion: number;
  rubricVersion: string;
  provider: string;
  requestedModel: string;
  returnedModel: string;
  source: {
    file: string;
    sessionId: string;
    version: 2 | 3;
    from: string;
    at: string;
    snapshotHash: string;
    references: SourceReference[];
  };
  parserWarnings: Warning[];
  projectionWarnings: ProjectionWarning[];
  requestHash: string;
  payloadBytes: number;
  answers: ValidatedAnswers;
  usage: ValidatedUsage;
  elapsedMs: number;
  reviewRequired: true;
}

// One invocation: prepare once, resolve one provider and credential, submit once.
export async function classifyEpisode(options: ClassifyOptions): Promise<ClassifyReport> {
  const provider = resolveProvider(options.providers, options.env);
  const prepared = await prepareEpisode(options.file, options.from, options.at, provider.model);
  const credential = readCredential(provider, options.env);
  options.onProviderResolved?.(provider);
  const now = options.now ?? Date.now;
  const started = now();
  const envelope = await provider.submit(prepared.serializedRequest, credential);
  const validated = validateResponse(envelope, provider.acceptsReturnedModel);
  const elapsedMs = Math.max(0, now() - started);
  // Explicit allowlist: never spread the prepared request or the provider object.
  return {
    schemaVersion: prepared.schemaVersion,
    rubricVersion: prepared.rubricVersion,
    provider: provider.name,
    requestedModel: provider.model,
    returnedModel: validated.returnedModel,
    source: prepared.source,
    parserWarnings: prepared.parserWarnings,
    projectionWarnings: prepared.projectionWarnings,
    requestHash: prepared.requestHash,
    payloadBytes: prepared.payloadBytes,
    answers: validated.answers,
    usage: validated.usage,
    elapsedMs,
    reviewRequired: true,
  };
}
