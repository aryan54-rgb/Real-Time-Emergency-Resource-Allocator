import { minutesAgo } from '@/lib/client';
import type { Hospital } from '@/lib/types';

const ACTIVE_WITHIN_MIN = 1;

/** Shown while the demo availability simulator (`npm run simulate`) is changing counts. */
export function SimBadge({ hospitals, now }: { hospitals: Hospital[]; now: number }) {
  const latest = Math.max(0, ...hospitals.flatMap((h) => h.resources.map((r) => (r.sim_changed_at ? new Date(r.sim_changed_at).getTime() : 0))));
  if (!latest || minutesAgo(new Date(latest).toISOString(), now) > ACTIVE_WITHIN_MIN) return null;
  return <span className="badge badge-sim" title="Counts are also being changed by the demo availability simulator">Live simulation active</span>;
}
