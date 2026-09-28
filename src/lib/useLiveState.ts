'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { LiveState } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const POLL_MS = 2000;
// Safety net while on Realtime: catches missed events (half-open socket, paused project, missing grants).
const REALTIME_SAFETY_POLL_MS = 15000;

export type SyncMode = 'connecting' | 'realtime' | 'polling';

/**
 * Keeps a live copy of hospitals + requests.
 * With Supabase configured, database changes are pushed over Supabase Realtime and trigger a refetch;
 * otherwise (e.g. local Postgres) it polls. The server stays the single source of truth either way.
 */
export function useLiveState() {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SyncMode>('connecting');
  const [now, setNow] = useState(() => Date.now());
  const clockSkew = useRef(0);
  const inflight = useRef(false);
  const queued = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
      const s: LiveState = await res.json();
      clockSkew.current = new Date(s.serverTime).getTime() - Date.now();
      setState(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
      if (queued.current) { queued.current = false; void refresh(); }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = setInterval(() => setNow(Date.now() + clockSkew.current), 5000);
    const onWake = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    const stopWakeListeners = () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    };

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setMode('polling');
      const poll = setInterval(refresh, POLL_MS);
      return () => { clearInterval(tick); clearInterval(poll); stopWakeListeners(); };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 100); };
    let fallback: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const safety = setInterval(refresh, REALTIME_SAFETY_POLL_MS);
    const channel = supabase
      .channel('pulseroute-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_requests' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hospitals' }, onChange)
      .subscribe((status) => {
        // removeChannel() on unmount reports CLOSED; don't start a poller for a dead component.
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          setMode('realtime');
          clearInterval(fallback); fallback = undefined;
          void refresh(); // catch anything missed while connecting
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setMode('polling');
          fallback ??= setInterval(refresh, POLL_MS);
        }
      });
    return () => {
      disposed = true;
      clearInterval(tick); clearInterval(fallback); clearInterval(safety); clearTimeout(debounce);
      stopWakeListeners();
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { state, error, mode, refresh, now };
}
