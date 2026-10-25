import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEpisodeText } from '../../../src/episode/app/format-text.ts';
import type { ValidatedAnswers } from '../../../src/episode/domain/answers.ts';

const answers = (): ValidatedAnswers => ({
  interventionKind: {
    type: 'choice', choice: 'correction', confidence: 0.76,
    probabilities: { correction: 0.8, clarification: 0.02, requirement_change: 0.06,
      decision_response: 0.01, architecture_review: 0, insufficient_evidence: 0.11 },
  },
  observableIssue: {
    type: 'choice', choice: 'speculative_diagnosis', confidence: 0.69,
    probabilities: { abstraction_or_intent_mismatch: 0.01, explicit_constraint_missed: 0.02,
      unsupported_completion_claim: 0, speculative_diagnosis: 0.73, ownership_or_boundary_confusion: 0,
      other: 0.01, insufficient_evidence: 0.1, not_applicable: 0.13 },
  },
  effectiveIssue: 'speculative_diagnosis', flags: [],
});

test('renders the approved concise demo layout with sorted probabilities and no technical footer', () => {
  const result = formatEpisodeText(answers());
  assert.match(result, /^Episode Analysis\n/);
  assert.match(result, /Intervention\s+CORRECTION/);
  assert.match(result, /Observable issue\s+Speculative diagnosis/);
  assert.match(result, /Correction\s+█{16}\s+80%/);
  assert.ok(result.indexOf('Insufficient evidence') < result.indexOf('Requirement change'));
  assert.match(result, /Issue probability\s+73%/);
  assert.match(result, /Confidence\s+69%/);
  assert.match(result, /Review flags\s+None/);
  assert.doesNotMatch(result, /Architecture review|provider|model|tokens|hypothesis|verdict|\x1b/i);
  assert.ok(result.endsWith('\n'));
});

test('preserves contradiction and uncertainty flags using readable labels', () => {
  const input = answers();
  input.flags = ['contradictory_answers', 'insufficient_evidence'];
  assert.match(formatEpisodeText(input), /Contradictory answers, Insufficient evidence/);
});

test('does not present a raw issue as effective for non-corrections', () => {
  const input = answers();
  input.interventionKind.choice = 'clarification';
  input.effectiveIssue = 'not_applicable';
  input.flags = ['contradictory_answers'];
  const result = formatEpisodeText(input);
  assert.match(result, /Observable issue\s+Not applicable/);
  assert.match(result, /Issue probability\s+Not applicable/);
  assert.match(result, /Confidence\s+Not applicable/);
  assert.doesNotMatch(result, /Speculative diagnosis|73%|69%/);
});

test('shows small nonzero probabilities without rounding them to zero', () => {
  const input = answers();
  input.interventionKind.probabilities.architecture_review = 0.001;
  assert.match(formatEpisodeText(input), /Architecture review\s+<1%/);
});
