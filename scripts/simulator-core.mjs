// Deterministic demo availability simulator (HLTH02 "simulated live availability data").
//
// Each step: read the current counts, pick one (hospital, resource) with a seeded PRNG, and
// propose +1 (discharge) or -1 (walk-in admission). The change is applied through
// set_availability(..., 'simulator'), the same compare-and-set used by hospital staff, so a
// concurrent reservation/release makes the step a no-op instead of overwriting it.
// Same seed + same starting data + no other activity => identical sequence and final state.

import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_EXCLUDE = ['H1:icu_bed']; // keep the double-booking demo bed (1 free) untouched

// mulberry32: tiny, fast, deterministic PRNG. Returns floats in [0, 1).
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseExclude(value) {
  if (value === undefined) return DEFAULT_EXCLUDE;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Current counts plus how many units the system itself has given out (held/occupied reservations).
export async function readCounts(db) {
  const { rows } = await db.query(
    `select r.hospital_id, r.type, r.total, r.available,
            (select count(*)::int from reservations v
              where v.hospital_id = r.hospital_id and v.resource_type = r.type
                and v.status in ('held', 'occupied')) as in_use
       from resources r
      order by r.hospital_id, r.type`);
  return rows;
}

// Pure: choose the next change. Never proposes < 0, > total, or more free units than
// total - in_use. Returns null if nothing can change.
export function planStep(rows, rng, exclude = DEFAULT_EXCLUDE) {
  const skip = new Set(exclude);
  const candidates = rows
    .filter((r) => !skip.has(`${r.hospital_id}:${r.type}`) && !skip.has(r.hospital_id))
    .map((r) => ({ ...r, cap: Math.max(0, r.total - r.in_use) }))
    .filter((r) => r.cap > 0 || r.available > 0);
  if (candidates.length === 0) return null;

  const r = candidates[Math.floor(rng() * candidates.length)];
  const coin = rng(); // always consume one value so the sequence doesn't depend on which branch runs
  let delta;
  if (r.available <= 0) delta = +1;
  else if (r.available >= r.cap) delta = -1;
  else delta = coin < 0.5 ? -1 : +1;
  return { hospital_id: r.hospital_id, type: r.type, expected: r.available, available: r.available + delta, delta };
}

// Apply one planned change through the safe DB function.
// Returns 'applied' | 'stale' (someone changed the count first) | 'no_change' (capped).
export async function applyStep(db, step) {
  try {
    await db.query('select set_availability($1, $2, $3, $4, $5)',
      [step.hospital_id, step.type, step.expected, step.available, 'simulator']);
    return 'applied';
  } catch (e) {
    if (e.message === 'STALE_COUNT') return 'stale';
    if (e.message === 'SIM_NO_CHANGE') return 'no_change';
    throw e;
  }
}

export async function runSimulator(db, { seed = 42, steps = Infinity, intervalMs = 4000, exclude = DEFAULT_EXCLUDE,
  log = () => {}, signal } = {}) {
  const rng = createRng(seed);
  const history = [];
  for (let i = 1; i <= steps && !signal?.aborted; i++) {
    const step = planStep(await readCounts(db), rng, exclude);
    if (!step) break;
    const outcome = await applyStep(db, step);
    history.push({ ...step, outcome });
    log(`#${i} ${step.hospital_id} ${step.type} ${step.expected} -> ${step.available} (${step.delta > 0 ? 'discharge' : 'admission'}) ${outcome}`);
    if (intervalMs > 0 && i < steps) await sleep(intervalMs, undefined, { signal }).catch(() => {}); // Ctrl+C ends the wait
  }
  return history;
}
