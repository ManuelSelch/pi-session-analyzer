import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../src/sessions.ts';
import { header, call, jsonl } from './helpers.ts';

test('parses v3 entries with line evidence without changing input', () => {
  const text = jsonl(header(), call('a', null));
  const session = parseSession(text, 'fixture.jsonl');
  assert.equal(session.id, 'session-1');
  assert.equal(session.entries[0].line, 2);
  assert.deepEqual(session.warnings, []);
});

test('keeps usable entries and diagnoses malformed interior and truncated tail', () => {
  const text = jsonl(header()) + 'oops\n' + jsonl(call('a', null)) + '{"type":';
  const session = parseSession(text, 'fixture.jsonl');
  assert.equal(session.entries.length, 1);
  assert.deepEqual(session.warnings.map(w => [w.code, w.line]), [['malformed_line', 2], ['truncated_tail', 4]]);
});

test('accepts out-of-tree pi-chat session title metadata', () => {
  const s = parseSession(jsonl(header(), { type: 'session_info', name: 'Title', autoTitle: true }, call('a', null)), 'fixture.jsonl');
  assert.deepEqual(s.warnings, []);
  assert.equal(s.entries.length, 1);
});

test('rejects empty, unsupported, and legacy sessions explicitly', () => {
  for (const text of ['', jsonl({ ...header(), version: 99 }), jsonl({ ...header(), version: 1 })]) {
    assert.equal(parseSession(text, 'fixture.jsonl').usable, false);
  }
});

test('diagnoses duplicate IDs, broken parents, cycles, and unknown entry kinds', () => {
  const s = parseSession(jsonl(header(), call('a', 'b'), call('b', 'a'), call('c', 'missing'), call('c', null), call('e', 'missing'),
    { type: 'future', id: 'd', parentId: null }), 'fixture.jsonl');
  const codes = new Set(s.warnings.map(w => w.code));
  for (const code of ['duplicate_entry_id', 'missing_parent', 'parent_cycle', 'unknown_entry_type']) assert.ok(codes.has(code), code);
});
