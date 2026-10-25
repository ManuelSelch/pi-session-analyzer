import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../../../src/sessions.ts';
import { projectEpisode } from '../../../src/episode/domain/project.ts';
import { header, call, result, jsonl } from '../../helpers.ts';

const project = (...entries: unknown[]) => projectEpisode(parseSession(jsonl(header(), ...entries), '/private/source.jsonl').entries);
const message = (id: string, role: string, content: unknown) => ({ type: 'message', id, parentId: null,
  expectedAnswer: 'SECRET_LABEL', message: { role, content, usage: 'SECRET_USAGE' } });

test('preserves exact ordered text and tool evidence, retaining native source mappings locally', () => {
  const projection = project(message('native-user', 'user', 'Request\n你好'), call('native-call', null, 'tool-1', 'git status'),
    result('native-result', null, 'tool-1', true, 'exact output'), message('native-end', 'user', 'Still wrong'));
  assert.deepEqual(projection.entries, [
    { id: 'e1', role: 'user', content: [{ type: 'text', text: 'Request\n你好', blockIndex: 0 }] },
    { id: 'e2', role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'git status' }, blockIndex: 0 }] },
    { id: 'e3', role: 'toolResult', toolCallId: 'tool-1', toolName: 'bash', isError: true,
      content: [{ type: 'text', text: 'exact output', blockIndex: 0 }] },
    { id: 'e4', role: 'user', content: [{ type: 'text', text: 'Still wrong', blockIndex: 0 }] },
  ]);
  assert.deepEqual(projection.references[0], { id: 'e1', entryId: 'native-user', line: 2 });
  assert.deepEqual(projection.warnings.map(w => w.code), ['earlier_history_omitted', 'not_context_reconstruction']);
  const evidence = JSON.stringify({ entries: projection.entries, warnings: projection.warnings });
  for (const secret of ['native-user', 'SECRET_LABEL', 'SECRET_USAGE', '/private', '/project']) assert.ok(!evidence.includes(secret));
});

test('omits thinking, images, binary, unsupported blocks and entry fields with explicit limitations', () => {
  const projection = project(message('a', 'assistant', [
    { type: 'thinking', thinking: 'SECRET_THINKING', signature: 'SECRET_SIGNATURE' },
    { type: 'image', data: 'SECRET_IMAGE' }, { type: 'binary', data: 'SECRET_BINARY' },
    { type: 'future', text: 'SECRET_UNKNOWN' }, { type: 'text', text: 'visible', extra: 'SECRET_EXTRA' },
  ]), { type: 'compaction', id: 'b', parentId: null, summary: 'SECRET_SUMMARY' },
  message('c', 'custom', 'SECRET_CUSTOM'), message('d', 'user', { text: 'SECRET_BAD_CONTENT' }));
  const visible = JSON.stringify(projection.entries);
  assert.ok(visible.includes('visible'));
  assert.ok(!visible.includes('SECRET'));
  for (const code of ['thinking_omitted', 'binary_omitted', 'unsupported_block', 'non_message_omitted', 'unsupported_role', 'unsupported_content']) {
    assert.ok(projection.warnings.some(w => w.code === code), code);
  }
  assert.deepEqual(projection.warnings.find(w => w.code === 'thinking_omitted'), { code: 'thinking_omitted', entryId: 'e1', blockIndex: 0 });
});

test('sanitizes recognized hidden/binary argument blocks without changing ordinary JSON arguments', () => {
  const entry = message('a', 'assistant', [{ type: 'toolCall', id: 'tool-1', name: 'example', arguments: {
    command: 'echo visible', nested: [{ type: 'image', data: 'SECRET' }],
    data_base64: 'SECRET', text: 'ordinary', settings: { n: 2, enabled: false },
  } }]);
  const projection = project(entry);
  assert.ok(!JSON.stringify(projection.entries).includes('SECRET'));
  assert.ok(JSON.stringify(projection.entries).includes('ordinary'));
  assert.ok(projection.warnings.some(w => w.code === 'binary_omitted'));
});

test('discloses invalid tool blocks and tool results without selected prior calls', () => {
  const projection = project(message('a', 'assistant', [{ type: 'toolCall', name: 'bash' }]),
    result('b', null, 'outside', false, 'output'));
  assert.ok(projection.warnings.some(w => w.code === 'unsupported_block'));
  assert.ok(projection.warnings.some(w => w.code === 'tool_call_outside_episode'));
});
