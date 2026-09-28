import type { SyncMode } from '@/lib/useLiveState';

const LABEL: Record<SyncMode, string> = {
  connecting: 'Connecting…',
  realtime: 'Live · Supabase Realtime',
  polling: 'Live · polling every 2 s',
};

export function SyncBadge({ mode, error }: { mode: SyncMode; error: string | null }) {
  if (error) return <span className="badge badge-bad" title={error}>Offline · {error}</span>;
  return <span className={`badge ${mode === 'realtime' ? 'badge-ok' : 'badge-muted'}`}>{LABEL[mode]}</span>;
}
