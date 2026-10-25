import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResponse } from '../../../src/episode/domain/answers.ts';
import { INTERVENTION_OPTIONS, ISSUE_OPTIONS } from '../../../src/episode/domain/request.ts';

const accepts = (id: string) => id === 'jev-1.14.0';
const spread = (options: readonly string[], selected: string, other = 0) =>
  Object.fromEntries(options.map(option => [option, option === selected ? 1 - other : other / (options.length - 1)]));
const envelope = (kind = 'correction', issue = 'unsupported_completion_claim') => ({
  model: 'jev-1.14.0',
  answers: {
    intervention_kind: { type: 'choice', choice: kind, probabilities: spread(INTERVENTION_OPTIONS, kind), confidence: 0.9 },
    observable_issue: { type: 'choice', choice: issue, probabilities: spread(ISSUE_OPTIONS, issue), confidence: 0.8 },
  },
  usage: { input_tokens: 120, output_tokens: 12 },
  rationale: 'SECRET_RATIONALE',
});
const validate = (value: unknown) => validateResponse(value, accepts).answers;
const rejects = (value: unknown, code: string) => assert.throws(() => validate(value), { code, message: code });

test('accepts a valid envelope, preserves probabilities and drops unknown provider fields', () => {
  const valid = envelope();
  valid.answers.intervention_kind.probabilities = spread(INTERVENTION_OPTIONS, 'correction', 0.3);
  const result = validateResponse(valid, accepts);
  assert.equal(result.returnedModel, 'jev-1.14.0');
  assert.equal(result.answers.interventionKind.choice, 'correction');
  assert.equal(result.answers.interventionKind.probabilities.correction, 0.7);
  assert.equal(result.answers.interventionKind.confidence, 0.9);
  assert.equal(result.answers.effectiveIssue, 'unsupported_completion_claim');
  assert.deepEqual(result.answers.flags, []);
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 12 });
  assert.ok(!JSON.stringify(result).includes('SECRET_RATIONALE'));
});

test('rejects an unaccepted returned model and malformed envelopes', () => {
  rejects({ ...envelope(), model: 'typesafe/jev-1.13-20260917' }, 'model_mismatch');
  rejects({ ...envelope(), model: '' }, 'model_mismatch');
  rejects({}, 'model_mismatch');
  for (const value of [null, [], 'text', 7, { model: 'jev-1.14.0' }]) rejects(value, 'invalid_response');
});

test('requires exactly the two expected choice answers', () => {
  const missing = envelope();
  delete (missing.answers as Record<string, unknown>).observable_issue;
  rejects(missing, 'invalid_response');
  const extra = envelope();
  (extra.answers as Record<string, unknown>).tone = { type: 'choice', choice: 'calm', probabilities: { calm: 1 }, confidence: 1 };
  rejects(extra, 'invalid_response');
  rejects({ ...envelope(), answers: { ...envelope().answers, intervention_kind: { type: 'noul', noul: 0.9 } } }, 'invalid_response');
});

test('requires exact option keys, known winner and bounded finite numbers', () => {
  const wrongKey = envelope();
  wrongKey.answers.observable_issue.probabilities = { unsupported_completion_claim: 1, invented_issue: 0 } as never;
  rejects(wrongKey, 'invalid_response');
  const unknownWinner = envelope();
  unknownWinner.answers.observable_issue.choice = 'invented_issue';
  rejects(unknownWinner, 'invalid_response');
  for (const confidence of [-0.1, 1.1, Number.NaN, '0.5' as never]) {
    const value = envelope();
    value.answers.intervention_kind.confidence = confidence as number;
    rejects(value, 'invalid_response');
  }
  const negative = envelope();
  negative.answers.intervention_kind.probabilities.correction = -0.5;
  rejects(negative, 'invalid_response');
});

test('enforces the probability total tolerance and the selected maximum', () => {
  const probabilities = (correction: number, clarification: number) =>
    ({ ...spread(INTERVENTION_OPTIONS, 'correction', 0), correction, clarification });
  const withinTolerance = envelope();
  withinTolerance.answers.intervention_kind.probabilities = probabilities(0.9000005, 0.1);
  assert.equal(validate(withinTolerance).interventionKind.choice, 'correction');
  const outsideTolerance = envelope();
  outsideTolerance.answers.intervention_kind.probabilities = probabilities(0.9001, 0.1);
  rejects(outsideTolerance, 'invalid_response');
  const inconsistent = envelope();
  inconsistent.answers.intervention_kind.probabilities = probabilities(0.6, 0.4);
  inconsistent.answers.intervention_kind.choice = 'clarification';
  rejects(inconsistent, 'invalid_response');
  const tie = envelope();
  tie.answers.intervention_kind.probabilities = probabilities(0.5, 0.5);
  assert.equal(validate(tie).interventionKind.choice, 'correction');
});

test('requires nonnegative safe integer token counts', () => {
  for (const usage of [{ input_tokens: -1, output_tokens: 1 }, { input_tokens: 1.5, output_tokens: 1 },
    { input_tokens: 2 ** 53, output_tokens: 1 }, { input_tokens: '1', output_tokens: 1 }, { input_tokens: 1 }]) {
    rejects({ ...envelope(), usage }, 'invalid_response');
  }
  rejects({ ...envelope(), usage: undefined }, 'invalid_response');
});

test('derives the effective issue from the intervention kind and flags contradictions both ways', () => {
  assert.equal(validate(envelope('clarification', 'other')).effectiveIssue, 'not_applicable');
  assert.deepEqual(validate(envelope('clarification', 'other')).flags, ['contradictory_answers']);
  assert.deepEqual(validate(envelope('correction', 'not_applicable')).flags, ['contradictory_answers']);
  assert.equal(validate(envelope('correction', 'not_applicable')).effectiveIssue, 'not_applicable');
  assert.deepEqual(validate(envelope('decision_response', 'not_applicable')).flags, []);
});

test('flags uncertainty for insufficient evidence without inventing a reconciliation', () => {
  const kind = validate(envelope('insufficient_evidence', 'not_applicable'));
  assert.deepEqual(kind.flags, ['insufficient_evidence']);
  assert.equal(kind.effectiveIssue, 'not_applicable');
  const issue = validate(envelope('correction', 'insufficient_evidence'));
  assert.deepEqual(issue.flags, ['insufficient_evidence']);
  assert.equal(issue.effectiveIssue, 'insufficient_evidence');
});

test('includes provider cost only when it is a finite nonnegative number', () => {
  const cost = (usage: unknown) => validateResponse({ ...envelope(), usage }, accepts).usage.costUsd;
  assert.equal(cost({ input_tokens: 1, output_tokens: 2 }), undefined);
  assert.equal(cost({ input_tokens: 1, output_tokens: 2, cost: 0.000019 }), 0.000019);
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '0.1']) {
    assert.equal(cost({ input_tokens: 1, output_tokens: 2, cost: value }), undefined);
  }
});
