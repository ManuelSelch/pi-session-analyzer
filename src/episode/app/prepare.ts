import { createHash } from 'node:crypto';
import { readSession } from '../../sessions.ts';
import type { Warning } from '../../sessions.ts';
import { EpisodeError } from '../domain/errors.ts';
import { selectEpisode } from '../domain/select.ts';
import { projectEpisode } from '../domain/project.ts';
import type { ProjectionWarning, SourceReference } from '../domain/project.ts';
import { buildRequest, MODEL, RUBRIC_VERSION, SCHEMA_VERSION } from '../domain/request.ts';

export interface PreparedEpisode {
  schemaVersion: number;
  rubricVersion: string;
  model: string;
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
  serializedRequest: string;
  payloadBytes: number;
  requestHash: string;
}

// No scan, write, credentials, extension loading or transport in this use case.
export async function prepareEpisode(file: string, from: string, at: string): Promise<PreparedEpisode> {
  const session = await readSession(file).catch(() => { throw new EpisodeError('unreadable_session'); });
  const selected = selectEpisode(session, from, at);
  const projection = projectEpisode(selected);
  const request = buildRequest(projection);
  return {
    schemaVersion: SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    model: MODEL,
    source: {
      file: session.file,
      sessionId: session.id!,
      version: session.version as 2 | 3,
      from, at,
      snapshotHash: session.fingerprint,
      references: projection.references,
    },
    parserWarnings: session.warnings,
    projectionWarnings: projection.warnings,
    ...request,
    requestHash: createHash('sha256').update(request.serializedRequest).digest('hex'),
  };
}
