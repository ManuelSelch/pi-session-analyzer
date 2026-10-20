export const header = (id = 'session-1') => ({ type: 'session', version: 3, id, cwd: '/project' });
export const call = (id: string, parentId: string | null, toolCallId = id, command = 'git status', name = 'bash') => ({
  type: 'message', id, parentId, timestamp: '2026-01-01T00:00:00Z',
  message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name, arguments: { command } }] },
});
export const result = (id: string, parentId: string | null, toolCallId: string, isError = false, text = '', toolName = 'bash') => ({
  type: 'message', id, parentId, timestamp: '2026-01-01T00:00:01Z',
  message: { role: 'toolResult', toolCallId, toolName, isError, content: [{ type: 'text', text }] },
});
export const jsonl = (...entries: unknown[]) => entries.map(e => JSON.stringify(e)).join('\n') + '\n';
