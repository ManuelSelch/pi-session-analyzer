import { EpisodeError } from '../domain/errors.ts';
import type { ProviderPort } from '../app/provider.ts';

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 65_536;

export interface SystemOneProfile {
  name: string;
  model: string;
  url: string;
  credentialEnvVar: string;
  acceptsReturnedModel(returnedModel: string): boolean;
}

// A provider may answer with the pinned version or its dated build suffix.
export function versionedModel(model: string): (returnedModel: string) => boolean {
  const dated = new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}$`);
  return returnedModel => returnedModel === model || dated.test(returnedModel);
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* the body is being discarded anyway */ }
}

async function readBounded(response: Response, aborted: () => boolean): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new EpisodeError('response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof EpisodeError) throw error;
    throw aborted() ? new EpisodeError('timeout') : new EpisodeError('network_error');
  }
}

export function createSystemOneProvider(profile: SystemOneProfile,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): ProviderPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return {
    name: profile.name,
    model: profile.model,
    credentialEnvVar: profile.credentialEnvVar,
    acceptsReturnedModel: profile.acceptsReturnedModel,
    async submit(serializedRequest: string, credential: string): Promise<unknown> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await doFetch(profile.url, {
            method: 'POST',
            headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
            body: serializedRequest,
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch {
          throw controller.signal.aborted ? new EpisodeError('timeout') : new EpisodeError('network_error');
        }
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
          await discard(response);
          throw new EpisodeError('http_error', 'redirect_rejected');
        }
        if (response.status < 200 || response.status >= 300) {
          await discard(response);
          throw new EpisodeError('http_error', `HTTP ${response.status}`);
        }
        const text = await readBounded(response, () => controller.signal.aborted);
        try {
          return JSON.parse(text) as unknown;
        } catch { throw new EpisodeError('invalid_response'); }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
