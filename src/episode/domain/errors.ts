export type EpisodeErrorCode = 'unusable_session' | 'missing_boundary' | 'intervention_not_user' |
  'unrelated_start' | 'broken_ancestry' | 'parent_cycle' | 'forward_parent' |
  'payload_too_large' | 'unreadable_session';

export class EpisodeError extends Error {
  readonly code: EpisodeErrorCode;
  constructor(code: EpisodeErrorCode) {
    super(code);
    this.name = 'EpisodeError';
    this.code = code;
  }
}
