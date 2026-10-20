import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Json = Record<string, unknown>;
export const object = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
export interface Warning { code: string; file: string; line?: number }
export interface Entry { id: string; parentId: string | null; line: number; data: Json }
export interface Session {
  file: string; id: string | null; cwd: string | null; version: unknown;
  fingerprint: string; usable: boolean; entries: Entry[]; warnings: Warning[];
}
const knownTypes = new Set(['message', 'custom', 'custom_message', 'model_change', 'thinking_level_change',
  'session_info', 'compaction', 'context_edit', 'branch_summary', 'label', 'usage']);
const knownRoles = new Set(['system', 'user', 'assistant', 'toolResult', 'bashExecution', 'custom', 'branchSummary', 'compactionSummary']);

// Deliberately no SessionManager.open(): analysis must never migrate or rewrite logs.
export function parseSession(text: string, file: string): Session {
  const session: Session = { file, id: null, cwd: null, version: null,
    fingerprint: createHash('sha256').update(text).digest('hex'), usable: false, entries: [], warnings: [] };
  const warn = (code: string, line?: number) => session.warnings.push({ code, file, ...(line === undefined ? {} : { line }) });
  const lines = text.split('\n');
  const byId = new Map<string, Entry>();
  const duplicateIds = new Set<string>();
  let seenHeader = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let data: unknown;
    try { data = JSON.parse(lines[i]); }
    catch { warn(i === lines.length - 1 && !text.endsWith('\n') ? 'truncated_tail' : 'malformed_line', i + 1); continue; }
    if (!object(data)) { warn('invalid_entry', i + 1); continue; }
    if (data.type === 'session') {
      if (seenHeader || i !== 0) { session.usable = false; warn('invalid_header', i + 1); continue; }
      seenHeader = true;
      session.id = typeof data.id === 'string' && data.id.length > 0 ? data.id : null;
      session.cwd = typeof data.cwd === 'string' ? data.cwd : null;
      session.version = data.version ?? 1;
      session.usable = session.id !== null && [2, 3].includes(Number(session.version));
      if (!session.id) warn('missing_session_id', i + 1);
      if (data.version !== 2 && data.version !== 3) { session.usable = false; warn('unsupported_version', i + 1); }
      continue;
    }
    // Pi-chat can append title-only metadata outside the session tree.
    if (data.type === 'session_info' && data.id === undefined && data.parentId === undefined) continue;
    if (typeof data.id !== 'string' || !data.id || !(data.parentId === null || typeof data.parentId === 'string')) {
      warn('invalid_entry', i + 1); continue;
    }
    if (byId.has(data.id)) { duplicateIds.add(data.id); warn('duplicate_entry_id', i + 1); continue; }
    const entry: Entry = { id: data.id, parentId: data.parentId, line: i + 1, data };
    session.entries.push(entry);
    byId.set(entry.id, entry);
    if (!knownTypes.has(String(data.type))) warn('unknown_entry_type', i + 1);
    if (data.type === 'message' && (!object(data.message) || !knownRoles.has(String(data.message.role)))) warn('unknown_message_role', i + 1);
  }
  if (!seenHeader) warn('missing_header');
  // No occurrence of an ambiguous entry ID can support trustworthy matching.
  session.entries = session.entries.filter(e => !duplicateIds.has(e.id));
  for (const id of duplicateIds) byId.delete(id);
  // Linear-time validation of parent chains; matching still checks ancestry before counting results.
  const checked = new Set<string>();
  for (const entry of session.entries) {
    const chain = new Set<string>();
    let current: Entry | undefined = entry;
    while (current && !checked.has(current.id)) {
      if (chain.has(current.id)) { warn('parent_cycle', current.line); break; }
      chain.add(current.id);
      if (current.parentId === null) break;
      const parent = byId.get(current.parentId);
      if (!parent) { warn('missing_parent', current.line); break; }
      if (parent.line > current.line) warn('forward_parent', current.line);
      current = parent;
    }
    for (const id of chain) checked.add(id);
  }
  return session;
}

export async function readSession(file: string): Promise<Session> {
  return parseSession(await readFile(file, 'utf8'), file);
}

export async function discover(root: string): Promise<{ files: string[]; warnings: Warning[] }> {
  const files: string[] = [];
  const warnings: Warning[] = [];
  async function visit(dir: string, top = false): Promise<void> {
    let children;
    try { children = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (top) throw error; warnings.push({ code: 'unreadable_directory', file: dir }); return; }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(dir, child.name);
      if (child.isDirectory()) await visit(path);
      else if (child.isFile() && child.name.endsWith('.jsonl')) files.push(path);
      // Symlinks are not followed: avoid cycles and scanning outside the selected root.
    }
  }
  await visit(root, true);
  return { files: files.sort(), warnings };
}
