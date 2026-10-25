import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../../../src/sessions.ts';
import { selectEpisode } from '../../../src/episode/domain/select.ts';
import { header, jsonl } from '../../helpers.ts';

const message = (id: string, parentId: string | null, role = 'user') => ({
  type: 'message', id, parentId, message: { role, content: 'same text' },
});
const select = (entries: unknown[], from = 'a', at = 'c', version = 3) =>
  selectEpisode(parseSession(jsonl({ ...header(), version }, ...entries), 'private.jsonl'), from, at);
const rejects = (entries: unknown[], code: string, from = 'a', at = 'c') =>
  assert.throws(() => select(entries, from, at), { message: code, code });

test('selects inclusive v2/v3 ancestry, not siblings or later repeated text', () => {
  for (const version of [2, 3]) {
    const entries = select([message('old', null), message('a', 'old'), message('b', 'a', 'assistant'),
      message('sibling', 'a'), message('c', 'b'), message('later', 'c')], 'a', 'c', version);
    assert.deepEqual(entries.map(e => e.id), ['a', 'b', 'c']);
  }
});

test('accepts a single user entry and ignores ancestry before the explicit start', () => {
  assert.deepEqual(select([message('a', 'outside')], 'a', 'a').map(e => e.id), ['a']);
});

test('rejects missing or ambiguous boundaries and non-user interventions', () => {
  rejects([message('c', null)], 'missing_boundary');
  rejects([message('a', null), message('c', 'a'), message('c', 'a')], 'missing_boundary');
  rejects([message('a', null), message('c', 'a', 'assistant')], 'intervention_not_user');
});

test('rejects unrelated starts, broken or ambiguous ancestry, cycles and forward parents', () => {
  rejects([message('a', null), message('c', null)], 'unrelated_start');
  rejects([message('a', null), message('c', 'missing')], 'broken_ancestry');
  rejects([message('a', null), message('b', 'a'), message('b', 'a'), message('c', 'b')], 'broken_ancestry');
  rejects([message('a', null), message('b', 'c'), message('c', 'b')], 'parent_cycle');
  rejects([message('c', 'a'), message('a', null)], 'forward_parent');
});

test('rejects unusable sessions without leaking input', () => {
  assert.throws(() => select([], 'secret', 'secret', 1), { code: 'unusable_session', message: 'unusable_session' });
});
