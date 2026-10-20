import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { header, call, result, jsonl } from './helpers.ts';
const cli = resolve('src/cli.ts');
function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pi-analysis-test-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('summary discovers recursively, counts copies once, and does not leak bodies or modify sources', async () => fixture(async root => {
  await mkdir(join(root, 'nested'));
  const file = join(root, 'a.jsonl');
  const text = jsonl(header(), call('a', null, 'a', 'echo SECRET_COMMAND'), result('b', 'a', 'a', true, 'SECRET_OUTPUT'));
  await writeFile(file, text);
  await writeFile(join(root, 'nested', 'copy.jsonl'), text);
  const r = run('bash', 'summary', '--root', root);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.totals.calls, 1);
  assert.equal(report.totals.errors, 1);
  assert.equal(report.coverage.duplicateFiles, 1);
  assert.equal(report.coverage.sessions, 1);
  assert.equal(report.coverage.discoveredFiles, 2);
  assert.equal(r.stdout.includes('SECRET'), false);
  assert.equal(await readFile(file, 'utf8'), text);
}));

test('calls paginate, filter failures, and reveal only explicitly requested bounded content', async () => fixture(async root => {
  const file = join(root, 'a.jsonl');
  await writeFile(file, jsonl(header(), call('a', null), result('b', 'a', 'a'), call('c', 'b', 'c', 'echo SECRET'),
    result('d', 'c', 'c', true, 'X'.repeat(4000)), call('e', 'd')));
  const r = run('bash', 'calls', file, '--failed', '--include-content', '--limit', '1');
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.pagination.total, 1);
  assert.equal(report.calls[0].command, 'echo SECRET');
  assert.equal(report.calls[0].outputExcerpt.length, 2000);
  assert.equal(report.calls[0].outputTruncated, true);
  assert.equal(report.calls[0].source.line, 4);
  const paged = JSON.parse(run('bash', 'calls', file, '--offset', '1', '--limit', '1').stdout);
  assert.equal(paged.calls[0].toolCallId, 'c');
  assert.equal('command' in paged.calls[0], false);
  assert.equal('output' in paged.calls[0], false);
}));

test('conflicting session copies are skipped rather than silently merged', async () => fixture(async root => {
  await writeFile(join(root, 'a.jsonl'), jsonl(header(), call('a', null)));
  await writeFile(join(root, 'b.jsonl'), jsonl(header(), call('b', null)));
  const r = run('bash', 'summary', '--root', root);
  assert.equal(r.status, 2);
  const report = JSON.parse(r.stdout);
  assert.equal(report.coverage.conflictingFiles, 2);
  assert.equal(report.totals.calls, 0);
  assert.ok(report.warnings.some((w: { code: string }) => w.code === 'conflicting_session_copy'));
}));

test('empty input succeeds, damaged/unsupported logs yield partial reports, invalid invocations fail', async () => fixture(async root => {
  assert.equal(run('bash', 'summary', '--root', root).status, 0);
  await writeFile(join(root, 'a.jsonl'), jsonl(header(), call('a', null)) + '{"type":');
  await writeFile(join(root, 'old.jsonl'), jsonl({ ...header('old'), version: 1 }));
  const partial = run('bash', 'summary', '--root', root);
  assert.equal(partial.status, 2);
  const report = JSON.parse(partial.stdout);
  assert.equal(report.coverage.partialFiles, 1);
  assert.equal(report.coverage.skippedFiles, 1);
  assert.equal(report.totals.calls, 1);
  assert.equal(report.status, 'partial');
  for (const args of [[], ['bash', 'summary', '--limit', '1'], ['bash', 'calls'], ['bash', 'calls', 'missing'],
    ['bash', 'calls', 'x', '--limit', '-1'], ['bash', 'summary', '--root', join(root, 'missing')]]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
  }
}));
