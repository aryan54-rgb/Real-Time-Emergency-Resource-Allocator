import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { seed } from '../scripts/db-tools.mjs';
import { createRng, DEFAULT_EXCLUDE, parseExclude, planStep, readCounts, runSimulator } from '../scripts/simulator-core.mjs';

describe('simulator planning (pure)', () => {
  it('the PRNG is deterministic per seed', () => {
    const seq = (s) => { const r = createRng(s); return Array.from({ length: 5 }, r); };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
    expect(seq(42).every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('never proposes a count below 0, above total, or above total - in_use', () => {
    const rng = createRng(1);
    for (let i = 0; i < 5000; i++) {
      const total = Math.floor(rng() * 6);
      const inUse = Math.floor(rng() * (total + 1));
      const available = Math.floor(rng() * (total - inUse + 1));
      const step = planStep([{ hospital_id: 'X', type: 'icu_bed', total, available, in_use: inUse }], rng, []);
      if (total - inUse === 0 && available === 0) { expect(step).toBeNull(); continue; }
      expect(step.available).toBeGreaterThanOrEqual(0);
      expect(step.available).toBeLessThanOrEqual(total - inUse);
      expect(Math.abs(step.delta)).toBe(1);
    }
  });

  it('respects exclusions; by default leaves the double-booking demo bed (H1 ICU) alone', () => {
    expect(DEFAULT_EXCLUDE).toEqual(['H1:icu_bed']);
    expect(parseExclude('')).toEqual([]);
    expect(parseExclude('H2, H3:ventilator')).toEqual(['H2', 'H3:ventilator']);
    const rows = [
      { hospital_id: 'H1', type: 'icu_bed', total: 6, available: 1, in_use: 0 },
      { hospital_id: 'H2', type: 'icu_bed', total: 6, available: 1, in_use: 0 },
    ];
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) expect(planStep(rows, rng).hospital_id).toBe('H2');
    expect(planStep(rows, rng, ['H1', 'H2'])).toBeNull();
  });
});

describe('simulator against the database', () => {
  const pool = new pg.Pool({ connectionString: inject('databaseUrl'), max: 30 });
  afterAll(() => pool.end());
  beforeEach(() => seed(pool));

  const snapshot = async () =>
    (await pool.query('select hospital_id, type, available, updated_at from resources order by 1, 2')).rows;
  const newRequest = async (needs = ['icu_bed']) =>
    (await pool.query(`insert into emergency_requests (patient_label, severity, needs, lat, lng)
                       values ('sim', 'critical', $1, 18.6, 73.8) returning id`, [needs])).rows[0].id;

  it('is reproducible: same seed + same start => identical changes and final counts', async () => {
    const run = async (s) => {
      await seed(pool);
      const history = await runSimulator(pool, { seed: s, steps: 60, intervalMs: 0 });
      return { history, counts: (await snapshot()).map((r) => `${r.hospital_id}:${r.type}=${r.available}`) };
    };
    const a = await run(7);
    const b = await run(7);
    const c = await run(8);
    expect(a.history).toHaveLength(60);
    expect(b).toEqual(a);
    expect(c.history).not.toEqual(a.history);
  });

  it('marks changes as simulated and does not count them as staff confirmations (freshness unchanged)', async () => {
    const before = await snapshot();
    const history = await runSimulator(pool, { seed: 42, steps: 40, intervalMs: 0 });
    expect(history.every((h) => h.outcome === 'applied')).toBe(true);
    const after = await snapshot();
    after.forEach((row, i) => expect(row.updated_at.getTime()).toBe(before[i].updated_at.getTime()));

    const touched = (await pool.query('select * from resources where sim_changed_at is not null')).rows;
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((r) => r.sim_delta === 1 || r.sim_delta === -1)).toBe(true);
    expect(touched.some((r) => r.hospital_id === 'H1' && r.type === 'icu_bed')).toBe(false); // default exclusion
  });

  it('keeps every count within [0, total - held - occupied] over a long run', async () => {
    for (const h of ['H4', 'H5']) await pool.query('select reserve_resources($1, $2)', [await newRequest(), h]);
    await runSimulator(pool, { seed: 99, steps: 400, intervalMs: 0, exclude: [] });
    for (const r of await readCounts(pool)) {
      expect(r.available).toBeGreaterThanOrEqual(0);
      expect(r.available + r.in_use).toBeLessThanOrEqual(r.total);
    }
  });

  it('cannot advertise units the system has already given out (DB-enforced cap)', async () => {
    for (let i = 0; i < 3; i++) await pool.query('select reserve_resources($1, $2)', [await newRequest(), 'H2']); // 3 -> 0 free, 3 held
    const res = (await pool.query(`select * from set_availability('H2', 'icu_bed', 0, 8, 'simulator')`)).rows[0];
    expect(res.available).toBe(5);                                   // total 8 - 3 held
    await expect(pool.query(`select set_availability('H2', 'icu_bed', 5, 6, 'simulator')`)).rejects.toThrow('SIM_NO_CHANGE');
    await expect(pool.query(`select set_availability('H2', 'icu_bed', 5, 6, 'bogus')`)).rejects.toThrow('BAD_SOURCE');
  });

  it('a stale simulator step is refused, never overwriting a reservation', async () => {
    await pool.query('select reserve_resources($1, $2)', [await newRequest(), 'H4']); // 4 -> 3
    await expect(pool.query(`select set_availability('H4', 'icu_bed', 4, 5, 'simulator')`)).rejects.toThrow('STALE_COUNT');
    expect((await pool.query(`select available from resources where hospital_id='H4' and type='icu_bed'`)).rows[0].available).toBe(3);
  });

  it('running concurrently with racing dispatchers never double-books', async () => {
    // Simulator hammers ICU counts (H1 included) while 30 dispatchers race for ICU beds at H1 and H3.
    const sim = runSimulator(pool, { seed: 5, steps: 300, intervalMs: 0, exclude: [] });
    const ids = await Promise.all(Array.from({ length: 30 }, () => newRequest()));
    const results = await Promise.allSettled(ids.map((id, i) => pool.query('select reserve_resources($1, $2)', [id, i % 2 ? 'H1' : 'H3'])));
    const history = await sim;

    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    expect(errors.every((m) => m === 'RESOURCE_UNAVAILABLE:icu_bed')).toBe(true);
    expect(history.every((h) => ['applied', 'stale', 'no_change'].includes(h.outcome))).toBe(true);
    for (const r of await readCounts(pool)) {
      expect(r.available).toBeGreaterThanOrEqual(0);
      expect(r.available + r.in_use).toBeLessThanOrEqual(r.total); // no unit promised twice
    }
    const holds = (await pool.query(`select count(*)::int n from reservations where status = 'held'`)).rows[0].n;
    expect(holds).toBe(results.filter((r) => r.status === 'fulfilled').length);
  });
});
