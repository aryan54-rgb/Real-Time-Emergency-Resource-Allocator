// Browser-side helpers for calling the API.
export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string };

export async function post<T = unknown>(url: string, payload: unknown = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    return { ok: false, status: res.status, error: data.error ?? 'ERROR', message: data.message ?? res.statusText };
  } catch (e) {
    return { ok: false, status: 0, error: 'NETWORK', message: (e as Error).message };
  }
}

export function minutesAgo(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 60000);
}

export function formatAge(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  return `${(min / 60).toFixed(1)} h ago`;
}
