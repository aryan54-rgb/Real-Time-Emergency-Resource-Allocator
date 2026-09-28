// Verifies Supabase Realtime + RLS against a real Supabase project (no app server needed).
//   1. anon key can READ the tables (RLS "demo read" policies)
//   2. anon key can NOT write (all writes must go through the Next.js server)
//   3. a DB change is pushed over Realtime to a subscriber, and how fast
// Needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (e.g. in .env.local).
//   npm run test:realtime
// Side effect: touches `updated_at` of H1's general_bed row a few times (count unchanged).
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import WebSocket from 'ws';

const { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY } = process.env;
if (!DATABASE_URL || !URL || !KEY) {
  console.error('Set DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY first (see README, Option B).');
  process.exit(2);
}
const ROUNDS = Number(process.env.ROUNDS ?? 5);
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) failures++; };

const supabase = createClient(URL, KEY, { realtime: { transport: WebSocket } });
const db = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

console.log(`Supabase Realtime check against ${URL}\n`);

// 1. anon read
const read = await supabase.from('resources').select('hospital_id, type, available').limit(50);
check(!read.error && read.data.length > 0, `anon can read resources (${read.data?.length ?? 0} rows)${read.error ? ' — ' + read.error.message : ''}`);

// 2. anon write must be blocked (RLS has no insert/update policies)
const before = (await db.query(`select available from resources where hospital_id='H1' and type='icu_bed'`)).rows[0]?.available;
const upd = await supabase.from('resources').update({ available: 999 }).eq('hospital_id', 'H1').eq('type', 'icu_bed').select();
const after = (await db.query(`select available from resources where hospital_id='H1' and type='icu_bed'`)).rows[0]?.available;
check(after === before && (upd.error || (upd.data ?? []).length === 0), `anon cannot modify resources (count stayed ${after})`);
const rpc = await supabase.rpc('reserve_resources', { p_request_id: '00000000-0000-0000-0000-000000000000', p_hospital_id: 'H1' });
check(!!rpc.error, `anon RPC to reserve_resources is refused or fails (${rpc.error?.message ?? 'NO ERROR — function is callable by anon!'})`);

// 3. realtime push latency
// One waiter per round; cleared on timeout so a late event can't be credited to the wrong round.
let waiter = null;
let dbListenerReady;
const dbListener = new Promise((resolve) => { dbListenerReady = resolve; });
const channel = supabase.channel('realtime-check')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'resources' }, (p) => {
    const w = waiter;
    waiter = null;
    w?.(p);
  })
  // Supabase confirms separately (after SUBSCRIBED) once the database listener is attached;
  // writes made before this confirmation can be missed.
  .on('system', {}, (p) => { if (p?.extension === 'postgres_changes') dbListenerReady(p.status); });
const subscribed = await new Promise((resolve) => {
  const t = setTimeout(() => resolve('TIMEOUT'), 15000);
  channel.subscribe((status) => { if (status !== 'CLOSED') { clearTimeout(t); resolve(status); } });
});
check(subscribed === 'SUBSCRIBED', `channel subscribed (status: ${subscribed})`);
const listener = await Promise.race([dbListener, new Promise((r) => setTimeout(() => r('TIMEOUT'), 15000))]);
check(listener === 'ok', `database change listener attached (status: ${listener})`);

if (subscribed === 'SUBSCRIBED' && listener === 'ok') {
  const latencies = [];
  for (let i = 0; i < ROUNDS; i++) {
    const got = new Promise((resolve) => {
      waiter = resolve;
      setTimeout(() => { if (waiter === resolve) waiter = null; resolve(null); }, 10000);
    });
    const t0 = performance.now();
    await db.query(`update resources set updated_at = now() where hospital_id = 'H1' and type = 'general_bed'`);
    const payload = await got;
    if (payload) latencies.push(performance.now() - t0);
    check(!!payload && payload.new?.hospital_id === 'H1', `round ${i + 1}: change event received${payload ? ` in ${Math.round(performance.now() - t0)} ms` : ' — TIMED OUT after 10 s'}`);
  }
  if (latencies.length) {
    latencies.sort((a, b) => a - b);
    console.log(`\n  latency ms: min ${Math.round(latencies[0])}, median ${Math.round(latencies[Math.floor(latencies.length / 2)])}, max ${Math.round(latencies.at(-1))} (write -> event at this client, includes network)`);
  }
}

await supabase.removeChannel(channel);
await db.end();
console.log(failures ? `\nFAILED (${failures} check(s))` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
