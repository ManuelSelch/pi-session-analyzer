import { test } from 'node:test';
import { EpisodeDriver } from '../support/episode-driver.ts';

test('prepares a native v2/v3 episode read-only with deterministic provenance', async t => {
  for (const version of [2, 3]) {
    const episode = await EpisodeDriver.open(t);
    const texts = ['Original request', 'Completed the change', 'That does not match the request'];
    await episode.givenConversation(texts, version);
    await episode.prepare();
    episode.thenPreparedTextIs(texts);
    await episode.thenRepreparingIsIdentical();
    await episode.thenSourceIsUnchangedAndNoFilesWritten();
  }
});

test('hashes the full snapshot separately from selected provider evidence', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['Original request', 'Claim', 'Correction']);
  await episode.prepare();
  await episode.thenOutsideChangeOnlyChangesSnapshot();
  await episode.thenEvidenceChangeChangesRequest();
});

test('keeps unrelated damaged branches out of provider evidence but discloses parser warnings locally', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenNativeEntries([
    { type: 'message', id: 'native-0', parentId: null, message: { role: 'user', content: 'Request' } },
    { type: 'message', id: 'native-2', parentId: 'native-0', message: { role: 'user', content: 'Response' } },
    { type: 'custom', id: 'PRIVATE_UNRELATED', parentId: 'missing' },
  ]);
  await episode.prepare();
  episode.thenParserWarningsStayLocal();
  await episode.thenSourceIsUnchangedAndNoFilesWritten();
});

test('fails safely on unreadable and unsupported session input', async t => {
  const episode = await EpisodeDriver.open(t);
  await episode.givenConversation(['request', 'response', 'correction'], 1);
  await episode.thenPreparationFails('unusable_session');
  await episode.thenSourceIsUnchangedAndNoFilesWritten();
  await episode.thenPreparationFails('unreadable_session', true);
});

test('projects synthetic native correction and negative-control development examples without adding expected labels', async t => {
  for (const texts of [
    ['Archive must be hover-only', 'The button is hover-only at opacity 0.55', 'It is still visible'],
    ['Please remove that option', 'Removed it', 'Restore that option after all'],
    ['Choose a design', 'I recommend the small driver. Do you want raw fixtures?', 'No, use your recommendation'],
    ['Design the workflow without async', 'Here is a synchronous design', 'Actually allow async during design'],
  ]) {
    const episode = await EpisodeDriver.open(t);
    await episode.givenConversation(texts);
    await episode.prepare();
    episode.thenPreparedTextIs(texts);
    await episode.thenSourceIsUnchangedAndNoFilesWritten();
  }
});
