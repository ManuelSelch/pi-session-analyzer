import { EpisodeError } from './errors.ts';
import { INTERVENTION_OPTIONS, ISSUE_OPTIONS } from './request.ts';
import type { InterventionKind, ObservableIssue } from './request.ts';

// Documented tolerances: probability sums and the selected-maximum check are
// provider float artefacts, not evidence of a different distribution.
export const PROBABILITY_TOTAL_TOLERANCE = 0.000001;
export const SELECTED_MAXIMUM_TOLERANCE = 0.000000001;

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export interface ChoiceAnswer<Option extends string> {
  type: 'choice';
  choice: Option;
  probabilities: Record<Option, number>;
  confidence: number;
}
export type AnswerFlag = 'contradictory_answers' | 'insufficient_evidence';
export interface ValidatedAnswers {
  interventionKind: ChoiceAnswer<InterventionKind>;
  observableIssue: ChoiceAnswer<ObservableIssue>;
  effectiveIssue: ObservableIssue;
  flags: AnswerFlag[];
}
export interface ValidatedUsage { inputTokens: number; outputTokens: number; costUsd?: number }
export interface ValidatedResponse {
  returnedModel: string;
  answers: ValidatedAnswers;
  usage: ValidatedUsage;
}

function choiceAnswer<Option extends string>(value: unknown, options: Option[]): ChoiceAnswer<Option> {
  if (!object(value) || value.type !== 'choice' || typeof value.choice !== 'string' || !options.includes(value.choice as Option)) {
    throw new EpisodeError('invalid_response');
  }
  const choice = value.choice as Option;
  const probabilities = value.probabilities;
  if (!object(probabilities) || Object.keys(probabilities).length !== options.length) throw new EpisodeError('invalid_response');
  let total = 0;
  let maximum = 0;
  for (const option of options) {
    const value = probabilities[option];
    if (!probability(value)) throw new EpisodeError('invalid_response');
    total += value;
    maximum = Math.max(maximum, value);
  }
  if (Math.abs(total - 1) > PROBABILITY_TOTAL_TOLERANCE) throw new EpisodeError('invalid_response');
  if (Math.abs(probabilities[choice] as number - maximum) > SELECTED_MAXIMUM_TOLERANCE) throw new EpisodeError('invalid_response');
  if (!probability(value.confidence)) throw new EpisodeError('invalid_response');
  return { type: 'choice', choice, probabilities: probabilities as Record<Option, number>, confidence: value.confidence };
}

export function validateResponse(envelope: unknown, acceptsReturnedModel: (returned: string) => boolean): ValidatedResponse {
  if (!object(envelope)) throw new EpisodeError('invalid_response');
  const returnedModel = envelope.model;
  if (typeof returnedModel !== 'string' || returnedModel.length === 0) throw new EpisodeError('model_mismatch');
  if (!acceptsReturnedModel(returnedModel)) throw new EpisodeError('model_mismatch');
  const answers = envelope.answers;
  if (!object(answers) || Object.keys(answers).length !== 2) throw new EpisodeError('invalid_response');
  const interventionKind = choiceAnswer(answers.intervention_kind, INTERVENTION_OPTIONS);
  const observableIssue = choiceAnswer(answers.observable_issue, ISSUE_OPTIONS);
  const usage = envelope.usage;
  if (!object(usage) || !count(usage.input_tokens) || !count(usage.output_tokens)) throw new EpisodeError('invalid_response');
  const validatedUsage: ValidatedUsage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  // Provider extension: include it only when it is usable, never as an estimate.
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) validatedUsage.costUsd = usage.cost;
  const flags: AnswerFlag[] = [];
  const corrective = interventionKind.choice === 'correction';
  const classified = observableIssue.choice !== 'not_applicable';
  if (corrective !== classified) flags.push('contradictory_answers');
  if (interventionKind.choice === 'insufficient_evidence' || observableIssue.choice === 'insufficient_evidence') {
    flags.push('insufficient_evidence');
  }
  return {
    returnedModel,
    answers: { interventionKind, observableIssue, effectiveIssue: corrective ? observableIssue.choice : 'not_applicable', flags },
    usage: validatedUsage,
  };
}
