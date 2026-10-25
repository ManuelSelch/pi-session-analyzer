import type { Entry } from '../../sessions.ts';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
export type ProjectionCode = 'earlier_history_omitted' | 'not_context_reconstruction' | 'thinking_omitted' |
  'binary_omitted' | 'unsupported_block' | 'non_message_omitted' | 'unsupported_role' |
  'unsupported_content' | 'tool_call_outside_episode' | 'incomplete_tool_result';
export interface ProjectionWarning { code: ProjectionCode; entryId?: string; blockIndex?: number }
export interface SourceReference { id: string; entryId: string; line: number }
export type EvidenceBlock = { type: 'text'; text: string; blockIndex: number } |
  { type: 'toolCall'; id: string; name: string; arguments: unknown; blockIndex: number };
export interface EvidenceEntry {
  id: string;
  role: 'user' | 'assistant' | 'toolResult' | 'omitted';
  content: EvidenceBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}
export interface Projection {
  entries: EvidenceEntry[];
  warnings: ProjectionWarning[];
  references: SourceReference[];
}

const binaryTypes = new Set(['image', 'binary', 'audio', 'video', 'file']);

// Native tool arguments are JSON, not necessarily plain command strings. Do not
// copy recognized embedded media/thinking, even when nested inside arguments.
function projectArguments(value: unknown, warn: (code: ProjectionCode) => void): unknown {
  if (Array.isArray(value)) return value.map(item => projectArguments(item, warn));
  if (!object(value)) return value;
  if (value.type === 'thinking') { warn('thinking_omitted'); return null; }
  if (binaryTypes.has(String(value.type))) { warn('binary_omitted'); return null; }
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'data_base64' || key === 'base64') { warn('binary_omitted'); return []; }
    return [[key, projectArguments(item, warn)]];
  }));
}

export function projectEpisode(selected: readonly Entry[]): Projection {
  const projection: Projection = { entries: [], references: [], warnings: [
    { code: 'earlier_history_omitted' }, { code: 'not_context_reconstruction' },
  ] };
  const priorCalls = new Set<string>();
  for (const [index, entry] of selected.entries()) {
    const id = `e${index + 1}`;
    projection.references.push({ id, entryId: entry.id, line: entry.line });
    const warn = (code: ProjectionCode, blockIndex?: number) => projection.warnings.push({ code, entryId: id,
      ...(blockIndex === undefined ? {} : { blockIndex }) });
    const evidence: EvidenceEntry = { id, role: 'omitted', content: [] };
    projection.entries.push(evidence);
    if (entry.data.type !== 'message') { warn('non_message_omitted'); continue; }
    const message = entry.data.message;
    if (!object(message) || !['user', 'assistant', 'toolResult'].includes(String(message.role))) {
      warn('unsupported_role'); continue;
    }
    evidence.role = message.role as EvidenceEntry['role'];
    if (evidence.role === 'toolResult') {
      if (typeof message.toolCallId === 'string') {
        evidence.toolCallId = message.toolCallId;
        if (!priorCalls.has(message.toolCallId)) warn('tool_call_outside_episode');
      } else warn('incomplete_tool_result');
      if (typeof message.toolName === 'string') evidence.toolName = message.toolName;
      else warn('incomplete_tool_result');
      if (typeof message.isError === 'boolean') evidence.isError = message.isError;
      else warn('incomplete_tool_result');
    }
    if (typeof message.content === 'string') {
      evidence.content.push({ type: 'text', text: message.content, blockIndex: 0 });
      continue;
    }
    if (!Array.isArray(message.content)) { warn('unsupported_content'); continue; }
    for (const [blockIndex, block] of message.content.entries()) {
      if (!object(block)) { warn('unsupported_block', blockIndex); continue; }
      if (block.type === 'thinking') { warn('thinking_omitted', blockIndex); continue; }
      if (binaryTypes.has(String(block.type))) { warn('binary_omitted', blockIndex); continue; }
      if (block.type === 'text' && typeof block.text === 'string') {
        evidence.content.push({ type: 'text', text: block.text, blockIndex });
      } else if (evidence.role === 'assistant' && block.type === 'toolCall' &&
        typeof block.id === 'string' && block.id.length > 0 && typeof block.name === 'string' &&
        block.name.length > 0 && object(block.arguments)) {
        evidence.content.push({ type: 'toolCall', id: block.id, name: block.name,
          arguments: projectArguments(block.arguments, code => warn(code, blockIndex)), blockIndex });
        priorCalls.add(block.id);
      } else warn('unsupported_block', blockIndex);
    }
  }
  return projection;
}
