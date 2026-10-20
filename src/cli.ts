import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { callsReport, summaryReport } from './reports.ts';

const usage = `Usage:
  node src/cli.ts bash summary [--root <directory>] [--include-content]
  node src/cli.ts bash calls <session.jsonl> [--failed] [--family <label>] [--reason <label>]
    [--include-content] [--limit 50] [--offset 0]

JSON only on stdout. Exit codes: 0 complete (including empty), 2 partial, 1 fatal/invocation error.
--include-content reveals potentially sensitive commands and output excerpts (2000 characters each).
`;
function integer(value: string | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Pagination must be a non-negative integer.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) throw new Error('Pagination value is out of range.');
  return n;
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string' }, failed: { type: 'boolean' }, 'include-content': { type: 'boolean' },
    family: { type: 'string' }, reason: { type: 'string' },
    limit: { type: 'string' }, offset: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { process.stdout.write(usage); return; }
  const [noun, action, file] = positionals;
  if (noun !== 'bash') throw new Error(usage);
  let report;
  if (action === 'summary' && positionals.length === 2) {
    if (values.failed || values.family !== undefined || values.reason !== undefined || values.limit !== undefined || values.offset !== undefined) throw new Error(usage);
    report = await summaryReport(resolve(values.root ?? join(homedir(), '.pi', 'agent', 'sessions')), values['include-content'] ?? false);
  } else if (action === 'calls' && positionals.length === 3 && file && values.root === undefined) {
    const limit = integer(values.limit, 50, 500);
    if (limit === 0) throw new Error('--limit must be between 1 and 500.');
    report = await callsReport(resolve(file), { failed: values.failed ?? false, includeContent: values['include-content'] ?? false,
      limit, offset: integer(values.offset, 0, Number.MAX_SAFE_INTEGER), family: values.family, reason: values.reason });
  } else throw new Error(usage);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'partial' ? 2 : 0;
}
main().catch(error => {
  // Never echo parsed log content into diagnostics.
  process.stderr.write((error instanceof Error ? error.message : 'Unable to analyze sessions.') + '\n');
  process.exitCode = 1;
});
