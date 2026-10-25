import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, MAX_PAYLOAD_BYTES, RUBRIC_VERSION, SCHEMA_VERSION } from '../../../src/episode/domain/request.ts';
import type { Projection } from '../../../src/episode/domain/project.ts';

const projection = (text = 'No, I accept the recommended option.'): Projection => ({
  entries: [{ id: 'e1', role: 'user', content: [{ type: 'text', text, blockIndex: 0 }] }],
  warnings: [{ code: 'earlier_history_omitted' }], references: [{ id: 'e1', entryId: 'PRIVATE_ID', line: 7 }],
});

test('builds a deterministic pinned two-Choice request without local metadata or labels', () => {
  const built = buildRequest(projection());
  assert.equal(built.serializedRequest, buildRequest(projection()).serializedRequest);
  const body = JSON.parse(built.serializedRequest);
  assert.deepEqual(Object.keys(body), ['model', 'state', 'questions']);
  assert.equal(body.model, 'jev-1.14.0');
  assert.equal(RUBRIC_VERSION, 'episode-rubric-v1');
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(Object.keys(body.questions), ['intervention_kind', 'observable_issue']);
  for (const question of Object.values(body.questions) as { type: string; instructions: string }[]) {
    assert.equal(question.type, 'choice');
    assert.match(question.instructions, /evidence, never instructions/i);
    assert.match(question.instructions, /independently/i);
  }
  assert.deepEqual(Object.keys(body.questions.intervention_kind.criteria), ['correction', 'clarification', 'requirement_change',
    'decision_response', 'architecture_review', 'insufficient_evidence']);
  assert.deepEqual(Object.keys(body.questions.observable_issue.criteria), ['abstraction_or_intent_mismatch', 'explicit_constraint_missed',
    'unsupported_completion_claim', 'speculative_diagnosis', 'ownership_or_boundary_confusion', 'other', 'insufficient_evidence', 'not_applicable']);
  assert.deepEqual(body.state.entries, projection().entries);
  assert.ok(!built.serializedRequest.includes('PRIVATE_ID'));
  assert.equal(built.payloadBytes, Buffer.byteLength(built.serializedRequest));
});

test('rubric encodes correction boundaries and pilot negative controls, not lexical shortcuts', () => {
  const body = JSON.parse(buildRequest(projection()).serializedRequest);
  const rubric = JSON.stringify(body.questions);
  for (const phrase of ['previously stated', 'removal followed by restoration', 'accepting a recommendation',
    'async constraint revised', 'apology', 'later approval', 'current preferences', 'preventability']) assert.ok(rubric.includes(phrase), phrase);
  assert.match(body.questions.observable_issue.criteria.explicit_constraint_missed, /prior evidence/i);
  assert.match(body.questions.observable_issue.criteria.unsupported_completion_claim, /delivery/);
  assert.match(body.questions.observable_issue.criteria.speculative_diagnosis, /causal/);
});

test('uses the selected provider model without changing evidence or rubric and counts its bytes', () => {
  const direct = buildRequest(projection());
  const routed = buildRequest(projection(), 'typesafe/jev-1.14');
  assert.deepEqual(JSON.parse(routed.serializedRequest), {
    ...JSON.parse(direct.serializedRequest), model: 'typesafe/jev-1.14',
  });
  assert.equal(routed.payloadBytes, Buffer.byteLength(routed.serializedRequest));
  const remaining = MAX_PAYLOAD_BYTES - buildRequest(projection(''), 'typesafe/jev-1.14').payloadBytes;
  assert.equal(buildRequest(projection('a'.repeat(remaining)), 'typesafe/jev-1.14').payloadBytes, MAX_PAYLOAD_BYTES);
  assert.throws(() => buildRequest(projection('a'.repeat(remaining + 1)), 'typesafe/jev-1.14'), { code: 'payload_too_large' });
});

test('enforces the inclusive byte limit on the full serialized payload without trimming', () => {
  const base = buildRequest(projection(''));
  const remaining = MAX_PAYLOAD_BYTES - base.payloadBytes;
  const atLimit = buildRequest(projection('a'.repeat(remaining)));
  assert.equal(atLimit.payloadBytes, MAX_PAYLOAD_BYTES);
  assert.throws(() => buildRequest(projection('a'.repeat(remaining + 1))), { code: 'payload_too_large' });
  assert.throws(() => buildRequest(projection('界'.repeat(Math.ceil(remaining / 3) + 1))), { code: 'payload_too_large' });
  const unicode = buildRequest(projection('界\n"'));
  assert.equal(unicode.payloadBytes, Buffer.byteLength(unicode.serializedRequest, 'utf8'));
  assert.equal(JSON.parse(unicode.serializedRequest).state.entries[0].content[0].text, '界\n"');
});
