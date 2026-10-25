import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESPONSE_BYTES, createSystemOneProvider, versionedModel } from '../../../src/episode/infra/systemone.ts';
import type { ProviderPort } from '../../../src/episode/app/provider.ts';

const profile = {
  name: 'openrouter', model: 'typesafe/jev-1.14', url: 'https://openrouter.example/api/v1/systemone',
  credentialEnvVar: 'OPENROUTER_API_KEY', acceptsReturnedModel: versionedModel('typesafe/jev-1.14'),
};
type FetchLike = typeof fetch;
const build = (fetchImpl: FetchLike, timeoutMs = 1000): ProviderPort =>
  createSystemOneProvider(profile, { fetchImpl, timeoutMs });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('submits once with the pinned model, exact endpoint, bearer credential and no redirects', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = build(async (url, init) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return json({ model: 'typesafe/jev-1.14', answers: {}, usage: { input_tokens: 1, output_tokens: 2 } });
  });
  const body = '{"model":"typesafe/jev-1.14"}';
  const result = await provider.submit(body, 'secret-key');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, profile.url);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.body, body);
  assert.deepEqual(calls[0].init.headers, { authorization: 'Bearer secret-key', 'content-type': 'application/json' });
  assert.equal((result as { model: string }).model, 'typesafe/jev-1.14');
  assert.equal(profile.acceptsReturnedModel('typesafe/jev-1.14-20260917'), true);
  assert.equal(profile.acceptsReturnedModel('typesafe/jev-1.13'), false);
});

test('rejects redirects and non-success statuses without reading or echoing the provider body', async () => {
  const probe = (status: number) => {
    const state = { read: false, cancelled: false };
    const response = { status, type: 'default', body: {
      getReader() { state.read = true; return { read: async () => ({ done: true }) }; },
      cancel() { state.cancelled = true; return Promise.resolve(); },
    } } as unknown as Response;
    return { state, response };
  };
  for (const status of [301, 302, 307]) {
    const redirect = probe(status);
    await assert.rejects(build(async () => redirect.response).submit('{}', 'key'),
      { code: 'http_error', detail: 'redirect_rejected' });
    assert.deepEqual(redirect.state, { read: false, cancelled: true });
  }
  const opaque = build(async () => ({ status: 0, type: 'opaqueredirect', body: null }) as unknown as Response);
  await assert.rejects(opaque.submit('{}', 'key'), { code: 'http_error', detail: 'redirect_rejected' });
  const failing = probe(500);
  await assert.rejects(build(async () => failing.response).submit('{}', 'key'), { code: 'http_error', detail: 'HTTP 500' });
  assert.deepEqual(failing.state, { read: false, cancelled: true });
  const echoing = build(async () => new Response('SECRET_PROVIDER_BODY', { status: 503 }));
  await assert.rejects(echoing.submit('{}', 'key'), (error: unknown) => {
    assert.ok(!JSON.stringify(error as object).includes('SECRET_PROVIDER_BODY'));
    return true;
  });
});

test('maps network failures and invalid JSON to fixed diagnostics', async () => {
  const offline = build(async () => { throw new Error('SECRET_NETWORK_DETAIL'); });
  await assert.rejects(offline.submit('{}', 'key'), (error: unknown) => {
    const failure = error as { code: string; message: string };
    assert.equal(failure.code, 'network_error');
    assert.ok(!JSON.stringify(failure).includes('SECRET_NETWORK_DETAIL'));
    return true;
  });
  const broken = build(async () => new Response('{not json', { status: 200 }));
  await assert.rejects(broken.submit('{}', 'key'), { code: 'invalid_response' });
  const empty = build(async () => new Response(null, { status: 204 }));
  await assert.rejects(empty.submit('{}', 'key'), { code: 'invalid_response' });
});

test('enforces the response size limit and cancels the remaining stream', async () => {
  let cancelled = false;
  const oversized = build(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(MAX_RESPONSE_BYTES)));
      controller.enqueue(new TextEncoder().encode('y'));
    },
    cancel() { cancelled = true; },
  }), { status: 200 }));
  await assert.rejects(oversized.submit('{}', 'key'), { code: 'response_too_large' });
  assert.equal(cancelled, true);
  const atLimit = build(async () => new Response('x'.repeat(MAX_RESPONSE_BYTES), { status: 200 }));
  await assert.rejects(atLimit.submit('{}', 'key'), { code: 'invalid_response' });
});

test('aborts a stalled response within the deadline instead of hanging', async () => {
  let aborted = false;
  const stalled = build(async (_url, init) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return new Response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => { aborted = true; controller.error(new Error('aborted')); }); },
    }), { status: 200 });
  }, 20);
  await assert.rejects(stalled.submit('{}', 'key'), { code: 'timeout' });
  assert.equal(aborted, true);
});

test('aborts while waiting for response headers within the same deadline', async () => {
  const slow = build(async (_url, init) => {
    const signal = (init as RequestInit).signal as AbortSignal;
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }, 20);
  await assert.rejects(slow.submit('{}', 'key'), { code: 'timeout' });
});
