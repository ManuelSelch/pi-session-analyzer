export type EpisodeErrorCode = 'unusable_session' | 'missing_boundary' | 'intervention_not_user' |
  'unrelated_start' | 'broken_ancestry' | 'parent_cycle' | 'forward_parent' |
  'payload_too_large' | 'unreadable_session' |
  'invalid_arguments' | 'unknown_provider' | 'missing_credentials' | 'invalid_credentials' |
  'timeout' | 'network_error' | 'http_error' | 'response_too_large' |
  'invalid_response' | 'model_mismatch';

export class EpisodeError extends Error {
  readonly code: EpisodeErrorCode;
  // Fixed, non-sensitive context only (for example an HTTP status). Never provider text.
  readonly detail?: string;
  constructor(code: EpisodeErrorCode, detail?: string) {
    super(code);
    this.name = 'EpisodeError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
