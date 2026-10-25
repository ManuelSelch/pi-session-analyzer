import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { prepareEpisode } from '../../../src/episode/app/prepare.ts';
import { classifyEpisode } from '../../../src/episode/app/classify.ts';
import type { ClassifyReport } from '../../../src/episode/app/classify.ts';
import type { ProviderPort } from '../../../src/episode/app/provider.ts';
import { header, jsonl } from '../../helpers.ts';

interface Submission { request: string; credential: string }
interface ProviderSpec { model?: string; credentialEnvVar?: string; accepts?: (returned: string) => boolean; response: unknown }

export class EpisodeDriver {
  private directory: string;
  private file: string;
  private original = '';
  private prepared?: Awaited<ReturnType<typeof prepareEpisode>>;
  private providers: Record<string, ProviderPort> = {};
  private models: Record<string, string> = {};
  private env: Record<string, string | undefined> = {};
  private submissions: Submission[] = [];
  private notices: string[] = [];
  private classified?: ClassifyReport;
  private failure?: unknown;

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

  get sessionFile(): string { return this.file; }
  get report(): ClassifyReport | undefined { return this.classified; }
  get submissionCount(): number { return this.submissions.length; }
  get registry(): Record<string, ProviderPort> { return this.providers; }
  get environment(): Record<string, string | undefined> { return this.env; }

  givenProvider(name: string, spec: ProviderSpec): void {
    this.models[name] = spec.model ?? `${name}-model`;
    this.providers[name] = {
      name,
      model: this.models[name]!,
      credentialEnvVar: spec.credentialEnvVar ?? `${name.toUpperCase()}_API_KEY`,
      acceptsReturnedModel: spec.accepts ?? (returned => returned === this.models[name]),
      submit: async (request, credential) => {
        this.submissions.push({ request, credential });
        return spec.response;
      },
    };
  }

  givenEnvironment(env: Record<string, string | undefined>): void {
    this.env = env;
  }

  async whenClassify(from = 'native-0', at = 'native-2'): Promise<void> {
    try {
      this.classified = await classifyEpisode({
        file: this.file, from, at, env: this.env, providers: this.providers,
        onProviderResolved: provider => this.notices.push(`provider=${provider.name} model=${provider.model}`),
      });
    } catch (error) { this.failure = error; }
  }

  thenSubmissionCountIs(count: number): void {
    assert.equal(this.submissions.length, count);
  }

  async thenSubmittedThePreparedRequest(): Promise<void> {
    const expected = await prepareEpisode(this.file, 'native-0', 'native-2');
    assert.equal(this.submissions.length, 1);
    assert.equal(this.submissions[0]!.request, expected.serializedRequest);
    assert.ok(this.classified);
    assert.equal(this.classified.requestHash, expected.requestHash);
    assert.equal(this.classified.payloadBytes, expected.payloadBytes);
  }

  thenClassifiedWith(provider: string, returnedModel = this.models[provider]): void {
    assert.ok(this.classified);
    assert.equal(this.classified.provider, provider);
    assert.equal(this.classified.requestedModel, this.models[provider]);
    assert.equal(this.classified.returnedModel, returnedModel);
    assert.equal(this.classified.reviewRequired, true);
    assert.equal(typeof this.classified.elapsedMs, 'number');
    assert.equal(this.classified.schemaVersion, 1);
    assert.equal(this.classified.rubricVersion, 'episode-rubric-v1');
    assert.deepEqual(this.notices, [`provider=${provider} model=${this.models[provider]}`]);
  }

  thenReportExcludes(text: string): void {
    assert.ok(this.classified);
    assert.ok(!JSON.stringify(this.classified).includes(text));
  }

  thenClassificationFails(code: string, detail?: string): void {
    const failure = this.failure as { code?: string; detail?: string } | undefined;
    assert.ok(failure, 'expected a classification failure');
    assert.equal(failure.code, code);
    if (detail !== undefined) assert.equal(failure.detail, detail);
    assert.equal(this.classified, undefined);
    // The provider notice precedes submission, so every submit attempt has exactly one.
    assert.equal(this.notices.length, this.submissions.length);
  }

  thenParserWarningsStayLocal(): void {
    assert.ok(this.prepared);
    assert.ok(this.prepared.parserWarnings.some(w => w.code === 'missing_parent'));
    assert.ok(!this.prepared.serializedRequest.includes('missing_parent'));
    assert.ok(!this.prepared.serializedRequest.includes('PRIVATE_UNRELATED'));
  }
}
