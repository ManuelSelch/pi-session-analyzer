import { discover, readSession } from './sessions.ts';
import type { Warning } from './sessions.ts';
import { extractBash, totals } from './bash.ts';
import type { BashCall, Inventory } from './bash.ts';

export interface CallOptions { failed: boolean; includeContent: boolean; limit: number; offset: number }
export function callRow(call: BashCall, includeContent = false) {
  return { source: call.source, toolCallId: call.toolCallId, outcome: call.outcome, result: call.result,
    ...(includeContent ? { command: call.command?.slice(0, 2000) ?? null,
      commandTruncated: (call.command?.length ?? 0) > 2000,
      outputExcerpt: call.output.slice(0, 2000), outputTruncated: call.output.length > 2000 } : {}) };
}
function envelope(source: string, warnings: Warning[]) {
  return { schemaVersion: 1, metricDefinitionVersion: 'bash-v1', generatedAt: new Date().toISOString(),
    source, scope: 'full_persisted_history', status: warnings.length ? 'partial' : 'complete',
    limitations: ['Different fork session IDs may contain copied history counted more than once.',
      'Error flags are tool-reported outcomes, not proven agent mistakes.',
      'Counts cover usable observed entries; damaged/unsupported files can hide additional calls.'], warnings };
}
export async function callsReport(file: string, options: CallOptions) {
  const session = await readSession(file);
  const inventory = extractBash(session);
  const warnings = [...session.warnings, ...inventory.warnings];
  const calls = inventory.calls.filter(c => !options.failed || c.outcome === 'error');
  return { ...envelope(file, warnings), filters: { failed: options.failed }, sessionId: session.id,
    usable: session.usable, totals: totals(inventory),
    pagination: { total: calls.length, offset: options.offset, limit: options.limit,
      nextOffset: options.offset + options.limit < calls.length ? options.offset + options.limit : null },
    calls: calls.slice(options.offset, options.offset + options.limit).map(c => callRow(c, options.includeContent)),
    unmatchedResults: inventory.unmatchedResults.slice(options.offset, options.offset + options.limit),
    unmatchedResultsTotal: inventory.unmatchedResults.length };
}

export async function summaryReport(root: string) {
  const discovery = await discover(root);
  const warnings = [...discovery.warnings];
  const coverage = { discoveredFiles: discovery.files.length, parsedFiles: 0, usableFiles: 0, analyzedFiles: 0,
    partialFiles: 0, skippedFiles: 0, duplicateFiles: 0, conflictingFiles: 0, sessions: 0 };
  const candidates = new Map<string, { file: string; fingerprint: string; cwd: string | null; inventory: Inventory; partial: boolean }[]>();
  for (const file of discovery.files) {
    let session;
    try { session = await readSession(file); }
    catch { warnings.push({ code: 'unreadable_file', file }); coverage.skippedFiles++; continue; }
    coverage.parsedFiles++;
    warnings.push(...session.warnings);
    if (!session.usable) { coverage.skippedFiles++; continue; }
    coverage.usableFiles++;
    const inventory = extractBash(session);
    warnings.push(...inventory.warnings);
    const partial = session.warnings.length + inventory.warnings.length > 0;
    if (partial) coverage.partialFiles++;
    const bucket = candidates.get(session.id!) ?? [];
    bucket.push({ file, fingerprint: session.fingerprint, cwd: session.cwd, inventory, partial });
    candidates.set(session.id!, bucket);
  }
  const inventories: Inventory[] = [];
  const sessions = [];
  for (const [id, copies] of candidates) {
    if (new Set(copies.map(c => c.fingerprint)).size > 1) {
      coverage.conflictingFiles += copies.length;
      coverage.skippedFiles += copies.length;
      for (const copy of copies) warnings.push({ code: 'conflicting_session_copy', file: copy.file });
      continue;
    }
    coverage.duplicateFiles += copies.length - 1;
    const chosen = copies[0];
    coverage.analyzedFiles++;
    coverage.sessions++;
    inventories.push(chosen.inventory);
    sessions.push({ sessionId: id, file: chosen.file, cwd: chosen.cwd, partial: chosen.partial, ...totals(chosen.inventory) });
  }
  const merged: Inventory = { calls: inventories.flatMap(i => i.calls), unmatchedResults: inventories.flatMap(i => i.unmatchedResults),
    directExecutions: inventories.reduce((n, i) => n + i.directExecutions, 0), warnings: [] };
  return { ...envelope(root, warnings), filters: {}, coverage, totals: totals(merged), sessions };
}
