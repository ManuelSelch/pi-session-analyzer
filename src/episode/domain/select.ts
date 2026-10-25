import type { Entry, Session } from '../../sessions.ts';
import { EpisodeError } from './errors.ts';

export function selectEpisode(session: Session, from: string, at: string): Entry[] {
  if (!session.usable) throw new EpisodeError('unusable_session');
  const byId = new Map(session.entries.map(entry => [entry.id, entry]));
  const start = byId.get(from);
  const intervention = byId.get(at);
  if (!start || !intervention) throw new EpisodeError('missing_boundary');
  const message = intervention.data.message as { role?: unknown } | undefined;
  if (intervention.data.type !== 'message' || message?.role !== 'user') {
    throw new EpisodeError('intervention_not_user');
  }
  const selected: Entry[] = [];
  const seen = new Set<string>();
  let current = intervention;
  let forwardParent = false;
  while (true) {
    if (seen.has(current.id)) throw new EpisodeError('parent_cycle');
    seen.add(current.id);
    selected.push(current);
    if (current.id === start.id) break;
    if (current.parentId === null) throw new EpisodeError('unrelated_start');
    const parent = byId.get(current.parentId);
    if (!parent) throw new EpisodeError('broken_ancestry');
    if (parent.line > current.line) forwardParent = true;
    current = parent;
  }
  if (forwardParent) throw new EpisodeError('forward_parent');
  return selected.reverse();
}
