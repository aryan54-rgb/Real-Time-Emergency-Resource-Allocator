import 'server-only';
import { Pool, type QueryResultRow } from 'pg';
import type { EmergencyRequest, Hospital, LiveState, Resource } from './types';

const globalForPool = globalThis as unknown as { pgPool?: Pool };

function pool(): Pool {
  if (!globalForPool.pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env.local');
    const local = /localhost|127\.0\.0\.1/.test(url);
    const p = new Pool({
      connectionString: url, max: 10, ssl: local ? false : { rejectUnauthorized: false },
      idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
    });
    // Without a listener, an idle connection dropped by the network/pooler crashes the Node process.
    p.on('error', (e) => console.error('pg idle client error:', e.message));
    globalForPool.pgPool = p;
  }
  return globalForPool.pgPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool().query<T>(text, params);
}

const ACTIVE = `status in ('pending', 'reserved', 'accepted')`;

export async function loadState(): Promise<LiveState> {
  // One snapshot: all reads see the same committed state (no "reserved" case next to a pre-reservation count).
  const client = await pool().connect();
  let h, r, q, t;
  try {
    await client.query('begin isolation level repeatable read read only');
    h = await client.query<Omit<Hospital, 'resources'>>('select id, name, address, lat, lng from hospitals order by id');
    r = await client.query<Resource & { hospital_id: string }>(
      'select hospital_id, type, total, available, updated_at, sim_changed_at, sim_delta from resources order by hospital_id, type');
    // Every active case is always returned; only closed history is capped.
    q = await client.query<EmergencyRequest>(
      `(select * from emergency_requests where ${ACTIVE})
       union all
       (select * from emergency_requests
         where status = 'handed_over' or (status = 'cancelled' and updated_at > now() - interval '10 minutes')
         order by updated_at desc limit 30)
       order by created_at desc`);
    t = await client.query<{ now: Date }>('select now()');
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const hospitals: Hospital[] = h.rows.map((x) => ({ ...x, resources: [] }));
  const byId = new Map(hospitals.map((x) => [x.id, x]));
  for (const { hospital_id, ...res } of r.rows) byId.get(hospital_id)?.resources.push(res);
  return { hospitals, requests: q.rows, serverTime: new Date(t.rows[0].now).toISOString() };
}
