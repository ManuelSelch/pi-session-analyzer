import type { ValidatedAnswers } from '../domain/answers.ts';
import { INTERVENTION_OPTIONS } from '../domain/request.ts';

const label = (value: string): string => {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const percent = (value: number): string => value > 0 && value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;

// Presentation only: no source content, provider metadata or generated rationale.
export function formatEpisodeText(answers: ValidatedAnswers): string {
  const { interventionKind, observableIssue, effectiveIssue, flags } = answers;
  const rows = INTERVENTION_OPTIONS
    .map(option => ({ option, probability: interventionKind.probabilities[option] }))
    .filter(row => row.probability > 0)
    .sort((a, b) => b.probability - a.probability)
    .map(({ option, probability }) =>
      `  ${label(option).padEnd(23)}${'█'.repeat(Math.round(probability * 20)).padEnd(22)}${percent(probability).padStart(4)}`);
  const applicable = effectiveIssue !== 'not_applicable';
  return [
    'Episode Analysis',
    '─'.repeat(51),
    '',
    `  Intervention      ${label(interventionKind.choice).toUpperCase()}`,
    `  Observable issue  ${label(effectiveIssue)}`,
    '',
    '  Intervention probabilities',
    ...rows,
    '',
    `  Issue probability     ${applicable ? percent(observableIssue.probabilities[effectiveIssue]) : 'Not applicable'}`,
    `  Confidence            ${applicable ? percent(observableIssue.confidence) : 'Not applicable'}`,
    `  Review flags          ${flags.length ? flags.map(label).join(', ') : 'None'}`,
    '',
  ].join('\n');
}
