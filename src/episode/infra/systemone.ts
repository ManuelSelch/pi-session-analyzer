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

function normalizeOpenRouterChatCompletion(profile: SystemOneProfile, envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object' || !('choices' in envelope)) throw new EpisodeError('invalid_response');
  const choices = (envelope as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new EpisodeError('invalid_response');
  const trimmed = content.trim();
  const stripped = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    : trimmed;
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { throw new EpisodeError('invalid_response'); }
  if (!parsed || typeof parsed !== 'object') throw new EpisodeError('invalid_response');
  const payload = parsed as Record<string, unknown>;
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
  const normalizedUsage = {
    input_tokens: Number((usage.input_tokens ?? usage.prompt_tokens ?? 0) as number),
    output_tokens: Number((usage.output_tokens ?? usage.completion_tokens ?? 0) as number),
    ...(usage.cost !== undefined && typeof usage.cost === 'number' ? { cost: usage.cost } : {}),
  };
  return {
    model: typeof payload.model === 'string' ? payload.model : profile.model,
    answers: payload.answers,
    usage: normalizedUsage,
  };
}

export function createSystemOneProvider(profile: SystemOneProfile,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): ProviderPort {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const openRouterChatCompletion = profile.name === 'openrouter' && profile.model === 'typesafe/jev-router';
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
        const requestBody = openRouterChatCompletion ? JSON.stringify({
          model: profile.model,
          messages: [{
            role: 'user',
            content: 'Return only valid JSON with keys model, answers, and usage. Use the supplied request as the evidence source and do not add commentary.\n\n' + serializedRequest,
          }],
          temperature: 0,
          max_tokens: 1024,
        }) : serializedRequest;
        const requestHeaders = openRouterChatCompletion
          ? {
              authorization: `Bearer ${credential}`,
              'content-type': 'application/json',
              'HTTP-Referer': 'https://localhost',
              'X-Title': 'pi-session-analyzer',
            }
          : { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
        try {
          response = await doFetch(openRouterChatCompletion ? 'https://openrouter.ai/api/v1/chat/completions' : profile.url, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
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
          const parsed = JSON.parse(text) as unknown;
          return openRouterChatCompletion ? normalizeOpenRouterChatCompletion(profile, parsed) : parsed;
        } catch { throw new EpisodeError('invalid_response'); }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
