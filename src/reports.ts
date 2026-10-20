import { discover, readSession } from './sessions.ts';
import type { Warning } from './sessions.ts';
import { extractBash, totals } from './bash.ts';
import type { BashCall, Inventory } from './bash.ts';
import { classify, CLASSIFIER_VERSION } from './classify.ts';

export interface CallOptions { failed: boolean; includeContent: boolean; limit: number; offset: number; family?: string; reason?: string }
export function callRow(call: BashCall, includeContent = false) {
  return { source: call.source, toolCallId: call.toolCallId, outcome: call.outcome, result: call.result,
    classification: classify(call), suspectedRetry: call.suspectedRetry ?? null,
    ...(includeContent ? { command: call.command?.slice(0, 2000) ?? null,
      commandTruncated: (call.command?.length ?? 0) > 2000,
      outputExcerpt: call.output.slice(0, 2000), outputTruncated: call.output.length > 2000 } : {}) };
}
function classificationReport(calls: BashCall[], projects: Map<string, string | null>, includeContent: boolean) {
  const classified = calls.map(call => ({ call, classification: classify(call) }));
  const totalErrors = calls.filter(c => c.outcome === 'error').length;
  function groups(kind: 'family' | 'failure') {
    const buckets = new Map<string, typeof classified>();
    for (const item of classified) {
      if (kind === 'failure' && item.call.outcome !== 'error') continue;
      const label = item.classification[kind].label;
      const bucket = buckets.get(label) ?? [];
      bucket.push(item);
      buckets.set(label, bucket);
    }
    return [...buckets].map(([label, items]) => {
      const errors = items.filter(i => i.call.outcome === 'error');
      const completed = items.filter(i => ['success', 'error'].includes(i.call.outcome)).length;
      const projectPaths = items.map(i => projects.get(i.call.source.sessionId)).filter(p => typeof p === 'string');
      return { label, calls: items.length, completed, errors: errors.length,
        errorRate: completed ? errors.length / completed : null,
        errorRateUnavailableReason: completed ? null : 'no_completed_calls',
        shareOfAllCalls: calls.length ? items.length / calls.length : null,
        shareOfAllFailures: totalErrors ? errors.length / totalErrors : null,
        affectedSessions: new Set(items.map(i => i.call.source.sessionId)).size,
        affectedProjects: new Set(projectPaths).size,
        sessionsWithoutProject: new Set(items.filter(i => !projects.get(i.call.source.sessionId)).map(i => i.call.source.sessionId)).size,
        potentiallyAvoidableErrors: errors.filter(i => i.classification.failure.potentiallyAvoidable).length,
        rules: [...new Set(items.map(i => i.classification[kind].rule))].sort(),
        examples: [...errors, ...items.filter(i => i.call.outcome !== 'error')].slice(0, 3).map(i => callRow(i.call, includeContent)) };
    }).sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.label.localeCompare(b.label, 'en'));
  }
  const families = groups('family');
  return { kind: 'heuristic', version: CLASSIFIER_VERSION,
    interpretation: 'Rules suggest possible causes, not proven agent mistakes. Avoidability is a triage hypothesis; counts include copied fork history.',
    families, failureReasons: groups('failure'),
    opportunities: families.filter(g => g.potentiallyAvoidableErrors > 0)
      .sort((a, b) => b.potentiallyAvoidableErrors - a.potentiallyAvoidableErrors || b.errors - a.errors || a.label.localeCompare(b.label, 'en')),
    suspectedImmediateRetries: calls.filter(c => c.suspectedRetry).length };
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
  const calls = inventory.calls.filter(c => {
    const classification = classify(c);
    return (!options.failed || c.outcome === 'error') && (!options.family || classification.family.label === options.family) &&
      (!options.reason || classification.failure.label === options.reason);
  });
  return { ...envelope(file, warnings), filters: { failed: options.failed, family: options.family ?? null, reason: options.reason ?? null }, sessionId: session.id,
    usable: session.usable, totals: totals(inventory),
    pagination: { total: calls.length, offset: options.offset, limit: options.limit,
      nextOffset: options.offset + options.limit < calls.length ? options.offset + options.limit : null },
    calls: calls.slice(options.offset, options.offset + options.limit).map(c => callRow(c, options.includeContent)),
    unmatchedResults: inventory.unmatchedResults.slice(options.offset, options.offset + options.limit),
    unmatchedResultsTotal: inventory.unmatchedResults.length };
}

export async function summaryReport(root: string, includeContent = false) {
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
  return { ...envelope(root, warnings), filters: {}, coverage, totals: totals(merged), sessions,
    classification: classificationReport(merged.calls, new Map(sessions.map(s => [s.sessionId, s.cwd])), includeContent) };
}
