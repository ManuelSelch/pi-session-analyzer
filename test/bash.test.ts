import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../src/sessions.ts';
import { extractBash, totals } from '../src/bash.ts';
import { header, call, result, jsonl } from './helpers.ts';
const extract = (...entries: unknown[]) => extractBash(parseSession(jsonl(header(), ...entries), 'fixture.jsonl'));

test('matches successful, failed, namespaced, and unmatched calls with evidence', () => {
  const data = extract(call('a', null), result('b', 'a', 'a'), call('c', 'b', 'c', 'rg x', 'functions.bash'),
    result('d', 'c', 'c', true, 'error', 'functions.bash'), call('e', 'd'));
  assert.deepEqual(data.calls.map(c => c.outcome), ['success', 'error', 'unmatched']);
  assert.equal(data.calls[1].result?.line, 5);
  assert.deepEqual(totals(data), { calls: 3, completed: 2, errors: 1, unmatchedCalls: 1, ambiguousCalls: 0,
    unknownOutcomes: 0, unmatchedResults: 0, directExecutions: 0, errorRate: 0.5, errorRateUnavailableReason: null });
});

test('never matches a result to a sibling branch or a future call', () => {
  const data = extract(call('a', null, 'shared'), call('b', null, 'other'), result('c', 'b', 'shared'),
    result('d', null, 'future'), call('e', 'd', 'future'));
  assert.equal(totals(data).completed, 0);
  assert.equal(data.unmatchedResults.length, 2);
});

test('same provider ID on independent branches is resolved by ancestry', () => {
  const data = extract(call('a', null, 'shared'), result('b', 'a', 'shared'),
    call('c', null, 'shared'), result('d', 'c', 'shared', true));
  assert.equal(totals(data).completed, 2);
  assert.equal(totals(data).errors, 1);
});

test('duplicate results and ambiguous ancestral calls never inflate completions', () => {
  const duplicate = extract(call('a', null), result('b', 'a', 'a'), result('c', 'b', 'a'));
  assert.equal(totals(duplicate).completed, 0);
  assert.equal(duplicate.calls[0].outcome, 'ambiguous');
  const ambiguous = extract(call('a', null, 'same'), call('b', 'a', 'same'), result('c', 'b', 'same'));
  assert.equal(totals(ambiguous).completed, 0);
  assert.equal(ambiguous.calls[0].outcome, 'ambiguous');
  assert.ok(ambiguous.warnings.some(w => w.code === 'ambiguous_tool_match'));
});

test('distinguishes direct shell executions, invalid outcomes, and absent denominators', () => {
  const data = extract({ type: 'message', id: 'direct', parentId: null, message: { role: 'bashExecution', command: 'ls' } },
    call('a', 'direct'), { ...result('b', 'a', 'a'), message: { ...result('b', 'a', 'a').message, isError: undefined } });
  assert.equal(totals(data).calls, 1);
  assert.equal(totals(data).directExecutions, 1);
  assert.equal(totals(data).unknownOutcomes, 1);
  assert.equal(totals(data).errorRate, null);
});

test('labels only immediate identical-command repeats on the same branch as inferred retries', () => {
  const data = extract(call('a', null, 'a', 'git status'), result('b', 'a', 'a', true),
    call('c', 'b', 'c', 'git status'), result('d', 'c', 'c'), call('e', null, 'e', 'git status'));
  assert.equal(data.calls[1].suspectedRetry?.kind, 'inferred');
  assert.equal(data.calls[1].suspectedRetry?.previousCall.entryId, 'a');
  assert.equal(data.calls[2].suspectedRetry, undefined);
});

test('duplicate entry IDs cannot produce a trusted completion', () => {
  const data = extract(call('a', null), call('a', null, 'different'), result('b', 'a', 'a'));
  assert.equal(totals(data).completed, 0);
});

test('ignores non-bash tools and preserves null for missing command content', () => {
  const data = extract(call('a', null, 'a', 'secret', 'read'), result('b', 'a', 'a', false, '', 'read'),
    { ...call('c', 'b'), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'bash', arguments: {} }] } });
  assert.equal(data.calls.length, 1);
  assert.equal(data.calls[0].command, null);
  assert.ok(data.warnings.some(w => w.code === 'missing_bash_command'));
});
