import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { prepareEpisode } from '../../../src/episode/app/prepare.ts';
import { header, jsonl } from '../../helpers.ts';

export class EpisodeDriver {
  private directory: string;
  private file: string;
  private original = '';
  private prepared?: Awaited<ReturnType<typeof prepareEpisode>>;

  private constructor(directory: string) {
    this.directory = directory;
    this.file = join(directory, 'session.jsonl');
  }

  static async open(t: TestContext): Promise<EpisodeDriver> {
    const directory = await mkdtemp(join(tmpdir(), 'episode-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return new EpisodeDriver(directory);
  }

  async givenConversation(texts: string[], version = 3): Promise<void> {
    await this.givenNativeEntries(texts.map((text, i) => ({
      type: 'message', id: 'native-' + i, parentId: i ? 'native-' + (i - 1) : null,
      message: { role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text }] },
    })), version);
  }

  async givenNativeEntries(entries: unknown[], version = 3): Promise<void> {
    this.original = jsonl({ ...header(), version }, ...entries);
    await writeFile(this.file, this.original);
  }

  async prepare(from = 'native-0', at = 'native-2'): Promise<void> {
    this.prepared = await prepareEpisode(this.file, from, at);
  }

  thenPreparedTextIs(texts: string[]): void {
    assert.ok(this.prepared);
    const state = JSON.parse(this.prepared.serializedRequest).state;
    assert.deepEqual(state.entries.flatMap((e: { content: { text: string }[] }) => e.content.map(b => b.text)), texts);
    assert.equal(this.prepared.source.from, 'native-0');
    assert.equal(this.prepared.source.at, 'native-2');
    assert.equal(this.prepared.source.sessionId, 'session-1');
    assert.equal(this.prepared.model, 'jev-1.14.0');
    assert.equal(this.prepared.schemaVersion, 1);
    assert.equal(this.prepared.rubricVersion, 'episode-rubric-v1');
    assert.equal(this.prepared.source.references.length, 3);
    assert.equal(this.prepared.requestHash, createHash('sha256').update(this.prepared.serializedRequest).digest('hex'));
    assert.equal(this.prepared.source.snapshotHash, createHash('sha256').update(this.original).digest('hex'));
    assert.equal(this.prepared.payloadBytes, Buffer.byteLength(this.prepared.serializedRequest));
    assert.ok(!this.prepared.serializedRequest.includes(this.directory));
    assert.ok(!this.prepared.serializedRequest.includes('native-'));
  }

  async thenSourceIsUnchangedAndNoFilesWritten(): Promise<void> {
    assert.equal(await readFile(this.file, 'utf8'), this.original);
    assert.deepEqual(await readdir(this.directory), ['session.jsonl']);
  }

  async thenRepreparingIsIdentical(): Promise<void> {
    assert.ok(this.prepared);
    assert.deepEqual(await prepareEpisode(this.file, 'native-0', 'native-2'), this.prepared);
  }

  async thenOutsideChangeOnlyChangesSnapshot(): Promise<void> {
    assert.ok(this.prepared);
    const appended = { type: 'message', id: 'later', parentId: 'native-2', message: { role: 'user', content: 'later' } };
    await writeFile(this.file, this.original + jsonl(appended));
    const next = await prepareEpisode(this.file, 'native-0', 'native-2');
    assert.notEqual(next.source.snapshotHash, this.prepared.source.snapshotHash);
    assert.equal(next.requestHash, this.prepared.requestHash);
  }

  async thenEvidenceChangeChangesRequest(): Promise<void> {
    assert.ok(this.prepared);
    const changed = this.original.replace('Original request', 'Revised request');
    assert.notEqual(changed, this.original);
    await writeFile(this.file, changed);
    const next = await prepareEpisode(this.file, 'native-0', 'native-2');
    assert.notEqual(next.source.snapshotHash, this.prepared.source.snapshotHash);
    assert.notEqual(next.requestHash, this.prepared.requestHash);
  }

  async thenPreparationFails(code: string, missingFile = false): Promise<void> {
    if (missingFile) await rm(this.file, { force: true });
    await assert.rejects(prepareEpisode(this.file, 'native-0', 'native-2'), { code, message: code });
  }

  thenParserWarningsStayLocal(): void {
    assert.ok(this.prepared);
    assert.ok(this.prepared.parserWarnings.some(w => w.code === 'missing_parent'));
    assert.ok(!this.prepared.serializedRequest.includes('missing_parent'));
    assert.ok(!this.prepared.serializedRequest.includes('PRIVATE_UNRELATED'));
  }
}
