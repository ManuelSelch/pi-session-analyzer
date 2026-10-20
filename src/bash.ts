import { object } from './sessions.ts';
import type { Entry, Session, Warning } from './sessions.ts';

export interface Evidence { file: string; sessionId: string; entryId: string; line: number; timestamp: string | number | null }
export interface BashCall {
  source: Evidence; toolCallId: string; command: string | null;
  outcome: 'success' | 'error' | 'unmatched' | 'ambiguous' | 'unknown';
  result: Evidence | null; output: string;
  suspectedRetry?: { kind: 'inferred'; rule: string; previousCall: Evidence };
}
export interface Inventory { calls: BashCall[]; unmatchedResults: Evidence[]; directExecutions: number; warnings: Warning[] }
const isBash = (name: unknown) => typeof name === 'string' && name.split('.').at(-1) === 'bash';
export function evidence(session: Session, entry: Entry): Evidence {
  const timestamp = entry.data.timestamp;
  return { file: session.file, sessionId: session.id!, entryId: entry.id, line: entry.line,
    timestamp: typeof timestamp === 'string' || typeof timestamp === 'number' ? timestamp : null };
}
export function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(object).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

export function extractBash(session: Session): Inventory {
  const inventory: Inventory = { calls: [], unmatchedResults: [], directExecutions: 0, warnings: [] };
  if (!session.usable) return inventory;
  const warn = (code: string, entry: Entry) => inventory.warnings.push({ code, file: session.file, line: entry.line });
  const byId = new Map(session.entries.map(e => [e.id, e]));
  const callsById = new Map<string, { call: BashCall; entry: Entry }[]>();
  const results: { entry: Entry; toolCallId: string; isError: unknown; output: string }[] = [];
  for (const entry of session.entries) {
    if (entry.data.type !== 'message' || !object(entry.data.message)) continue;
    const msg = entry.data.message;
    if (msg.role === 'bashExecution') inventory.directExecutions++;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!object(block) || block.type !== 'toolCall' || !isBash(block.name)) continue;
        if (typeof block.id !== 'string' || !block.id) { warn('missing_tool_call_id', entry); continue; }
        const command = object(block.arguments) && typeof block.arguments.command === 'string' ? block.arguments.command : null;
        if (command === null) warn('missing_bash_command', entry);
        const call: BashCall = { source: evidence(session, entry), toolCallId: block.id, command,
          outcome: 'unmatched', result: null, output: '' };
        inventory.calls.push(call);
        const bucket = callsById.get(block.id) ?? [];
        bucket.push({ call, entry });
        callsById.set(block.id, bucket);
      }
    }
    if (msg.role === 'toolResult' && isBash(msg.toolName)) {
      if (typeof msg.toolCallId !== 'string') { warn('missing_tool_call_id', entry); inventory.unmatchedResults.push(evidence(session, entry)); continue; }
      results.push({ entry, toolCallId: msg.toolCallId, isError: msg.isError, output: textContent(msg.content) });
    }
  }
  const assigned = new Map<BashCall, typeof results>();
  for (const result of results) {
    const candidates = callsById.get(result.toolCallId) ?? [];
    const eligible: typeof candidates = [];
    if (candidates.length) {
      const ancestors = new Set<string>();
      const pending = new Set(candidates.map(c => c.entry.id));
      let id = result.entry.parentId;
      while (id !== null && !ancestors.has(id) && pending.size > 0) {
        const entry = byId.get(id);
        if (!entry || entry.line >= result.entry.line) break;
        ancestors.add(id);
        pending.delete(id);
        id = entry.parentId;
      }
      eligible.push(...candidates.filter(c => c.entry.line < result.entry.line && ancestors.has(c.entry.id)));
    }
    if (eligible.length !== 1) {
      if (eligible.length > 1) {
        warn('ambiguous_tool_match', result.entry);
        for (const c of eligible) c.call.outcome = 'ambiguous';
      } else warn('unmatched_tool_result', result.entry);
      inventory.unmatchedResults.push(evidence(session, result.entry));
      continue;
    }
    const call = eligible[0].call;
    const bucket = assigned.get(call) ?? [];
    bucket.push(result);
    assigned.set(call, bucket);
  }
  for (const [call, matches] of assigned) {
    if (matches.length !== 1 || call.outcome === 'ambiguous') {
      call.outcome = 'ambiguous';
      for (const match of matches) inventory.unmatchedResults.push(evidence(session, match.entry));
      warn('duplicate_tool_result', matches[0].entry);
      continue;
    }
    const match = matches[0];
    call.result = evidence(session, match.entry);
    call.output = match.output;
    call.outcome = typeof match.isError === 'boolean' ? (match.isError ? 'error' : 'success') : 'unknown';
    if (call.outcome === 'unknown') warn('missing_error_flag', match.entry);
  }
  const failuresByResult = new Map(inventory.calls.filter(c => c.outcome === 'error' && c.result).map(c => [c.result!.entryId, c]));
  for (const call of inventory.calls) {
    const parentId = byId.get(call.source.entryId)?.parentId;
    const previous = parentId ? failuresByResult.get(parentId) : undefined;
    if (previous && call.command !== null && call.command === previous.command) {
      call.suspectedRetry = { kind: 'inferred', rule: 'identical_command_immediately_after_failed_result', previousCall: previous.source };
    }
  }
  return inventory;
}

export function totals(inventory: Inventory) {
  const calls = inventory.calls;
  const completed = calls.filter(c => c.outcome === 'success' || c.outcome === 'error').length;
  const errors = calls.filter(c => c.outcome === 'error').length;
  return { calls: calls.length, completed, errors,
    unmatchedCalls: calls.filter(c => c.outcome === 'unmatched').length,
    ambiguousCalls: calls.filter(c => c.outcome === 'ambiguous').length,
    unknownOutcomes: calls.filter(c => c.outcome === 'unknown').length,
    unmatchedResults: inventory.unmatchedResults.length, directExecutions: inventory.directExecutions,
    errorRate: completed ? errors / completed : null,
    errorRateUnavailableReason: completed ? null : 'no_completed_calls' };
}
