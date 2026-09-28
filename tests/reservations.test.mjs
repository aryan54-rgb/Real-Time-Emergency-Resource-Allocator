import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { seed } from '../scripts/db-tools.mjs';

const pool = new pg.Pool({ connectionString: inject('databaseUrl'), max: 30 });
afterAll(() => pool.end());
beforeEach(() => seed(pool));

async function newRequest(needs = ['icu_bed'], label = 'P') {
  const { rows } = await pool.query(
    `insert into emergency_requests (patient_label, severity, needs, lat, lng)
     values ($1, 'critical', $2, 18.64, 73.77) returning id`, [label, needs]);
  return rows[0].id;
}
const reserve = (requestId, hospitalId) => pool.query('select * from reserve_resources($1, $2)', [requestId, hospitalId]);
const available = async (h, type) =>
  (await pool.query('select available from resources where hospital_id = $1 and type = $2', [h, type])).rows[0].available;
const request = async (id) => (await pool.query('select * from emergency_requests where id = $1', [id])).rows[0];
const holds = async (h) =>
  Number((await pool.query(`select count(*) from reservations where hospital_id = $1 and status = 'held'`, [h])).rows[0].count);

describe('double-booking prevention', () => {
  it('two simultaneous requests for the last ICU bed: exactly one succeeds', async () => {
    expect(await available('H1', 'icu_bed')).toBe(1); // seeded with exactly one free ICU bed
    const [a, b] = [await newRequest(['icu_bed'], 'A'), await newRequest(['icu_bed'], 'B')];

    const results = await Promise.allSettled([reserve(a, 'H1'), reserve(b, 'H1')]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.message).toBe('RESOURCE_UNAVAILABLE:icu_bed');
    expect(await available('H1', 'icu_bed')).toBe(0);
    expect(await holds('H1')).toBe(1);
    // the loser is untouched and can be rerouted to the next-ranked hospital
    const loser = results[0].status === 'rejected' ? a : b;
    expect((await request(loser)).status).toBe('pending');
    await reserve(loser, 'H4');
    expect((await request(loser)).status).toBe('reserved');
  });

  it('forced interleaving: second transaction waits on the row lock, then fails', async () => {
    const [a, b] = [await newRequest(), await newRequest()];
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('begin');
      await c1.query('select reserve_resources($1, $2)', [a, 'H1']); // holds the H1/icu_bed row lock
      const second = c2.query('select reserve_resources($1, $2)', [b, 'H1']).then(() => 'ok', (e) => e.message);
      await new Promise((r) => setTimeout(r, 300)); // c2 is now blocked on the lock
      await c1.query('commit');
      expect(await second).toBe('RESOURCE_UNAVAILABLE:icu_bed');
    } finally {
      c1.release();
      c2.release();
    }
    expect(await available('H1', 'icu_bed')).toBe(0);
  });

  it('20 concurrent requests for 4 ICU beds: exactly 4 succeed, count never negative', async () => {
    expect(await available('H4', 'icu_bed')).toBe(4);
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => newRequest(['icu_bed'], `R${i}`)));
    const results = await Promise.allSettled(ids.map((id) => reserve(id, 'H4')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(await available('H4', 'icu_bed')).toBe(0);
    expect(await holds('H4')).toBe(4);
  });

  it('one request cannot be reserved at two hospitals at once', async () => {
    const a = await newRequest();
    const results = await Promise.allSettled([reserve(a, 'H4'), reserve(a, 'H5')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Number((await pool.query('select count(*) from reservations where request_id = $1', [a])).rows[0].count)).toBe(1);
    expect((await available('H4', 'icu_bed')) + (await available('H5', 'icu_bed'))).toBe(4 + 6 - 1);
  });

  it('multi-resource reservation is all-or-nothing', async () => {
    const a = await newRequest(['icu_bed', 'cardiac_unit']); // H1 has 1 ICU bed but 0 cardiac units
    await expect(reserve(a, 'H1')).rejects.toThrow('RESOURCE_UNAVAILABLE:cardiac_unit');
    expect(await available('H1', 'icu_bed')).toBe(1); // ICU bed was rolled back
    expect((await request(a)).status).toBe('pending');
  });

  it('opposite need orders under concurrency do not deadlock', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      newRequest(i % 2 ? ['icu_bed', 'ventilator'] : ['ventilator', 'icu_bed'])));
    const results = await Promise.allSettled(ids.map((id) => reserve(id, 'H5'))); // H5: 6 ICU, 6 ventilators
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    expect(errors.every((m) => m.startsWith('RESOURCE_UNAVAILABLE'))).toBe(true);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(6);
    expect(await available('H5', 'icu_bed')).toBe(0);
    expect(await available('H5', 'ventilator')).toBe(0);
  });
});

describe('hospital confirmation and handover', () => {
  it('reject releases the hold and blocks re-reserving at the same hospital', async () => {
    const a = await newRequest();
    await reserve(a, 'H1');
    await pool.query('select respond_to_request($1, $2, false, $3)', [a, 'H1', 'no staff']);
    expect(await available('H1', 'icu_bed')).toBe(1);
    const r = await request(a);
    expect(r.status).toBe('pending');
    expect(r.rejected_by).toEqual(['H1']);
    await expect(reserve(a, 'H1')).rejects.toThrow('HOSPITAL_ALREADY_REJECTED');
  });

  it('only the reserved hospital can respond', async () => {
    const a = await newRequest();
    await reserve(a, 'H1');
    await expect(pool.query('select respond_to_request($1, $2, true)', [a, 'H2']))
      .rejects.toThrow('REQUEST_NOT_AWAITING_THIS_HOSPITAL');
  });

  it('accept then handover keeps the unit occupied', async () => {
    const a = await newRequest();
    await reserve(a, 'H1');
    await pool.query('select respond_to_request($1, $2, true)', [a, 'H1']);
    expect((await request(a)).status).toBe('accepted');
    await pool.query('select complete_handover($1, $2)', [a, 'H1']);
    expect((await request(a)).status).toBe('handed_over');
    expect(await available('H1', 'icu_bed')).toBe(0);
    const { rows } = await pool.query('select status from reservations where request_id = $1', [a]);
    expect(rows.map((x) => x.status)).toEqual(['occupied']);
  });

  it('handover is refused before the hospital accepts', async () => {
    const a = await newRequest();
    await reserve(a, 'H1');
    await expect(pool.query('select complete_handover($1, $2)', [a, 'H1'])).rejects.toThrow('REQUEST_NOT_ACCEPTED');
  });

  it('cancelling a reserved request releases its hold', async () => {
    const a = await newRequest();
    await reserve(a, 'H1');
    await pool.query('select cancel_request($1)', [a]);
    expect(await available('H1', 'icu_bed')).toBe(1);
    expect((await request(a)).status).toBe('cancelled');
  });

  it('staff availability updates are clamped to [0, total] and refresh updated_at', async () => {
    const before = (await pool.query(`select updated_at from resources where hospital_id='H2' and type='icu_bed'`)).rows[0].updated_at;
    await pool.query('select set_availability($1, $2, $3, $4)', ['H2', 'icu_bed', 3, 99]);
    const after = (await pool.query(`select available, updated_at from resources where hospital_id='H2' and type='icu_bed'`)).rows[0];
    expect(after.available).toBe(8);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('hospital count updates cannot re-open reserved units (regression)', () => {
  const setAvail = (h, type, expected, available) =>
    pool.query('select * from set_availability($1, $2, $3, $4)', [h, type, expected, available]);

  it('a stale "Confirm" from the hospital screen is refused, so the bed cannot be reserved twice', async () => {
    const shownOnStaffScreen = 1;                              // H1 screen shows 1 free ICU bed
    await reserve(await newRequest(), 'H1');                   // a dispatcher takes it meanwhile -> 0
    await expect(setAvail('H1', 'icu_bed', shownOnStaffScreen, shownOnStaffScreen)).rejects.toThrow('STALE_COUNT');
    await expect(reserve(await newRequest(), 'H1')).rejects.toThrow('RESOURCE_UNAVAILABLE:icu_bed');
    expect(await available('H1', 'icu_bed')).toBe(0);
    expect(await holds('H1')).toBe(1);
  });

  it('a stale "+" is refused; the same click based on the current count works', async () => {
    await reserve(await newRequest(), 'H1');                   // 1 -> 0
    await expect(setAvail('H1', 'icu_bed', 1, 2)).rejects.toThrow('STALE_COUNT');
    await setAvail('H1', 'icu_bed', 0, 1);                     // staff saw 0, one bed really freed up
    expect(await available('H1', 'icu_bed')).toBe(1);
  });

  it('concurrent staff "+" and dispatcher reserve never lose an update', async () => {
    for (let i = 0; i < 20; i++) {
      await seed(pool);                                        // H1 icu: 1 free
      const staff = setAvail('H1', 'icu_bed', 1, 2).then(() => 'ok', (e) => e.message);
      const disp = reserve(await newRequest(), 'H1').then(() => 'ok', (e) => e.message);
      const [s, d] = await Promise.all([staff, disp]);
      const left = await available('H1', 'icu_bed');
      // valid outcomes only: staff first (2 -> reserve -> 1) or reserve first (0, staff refused as stale)
      expect([`${s}|${d}|${left}`]).toContain(s === 'ok' ? 'ok|ok|1' : 'STALE_COUNT|ok|0');
    }
  });

  it('unknown resource still reports RESOURCE_NOT_FOUND', async () => {
    await expect(setAvail('H1', 'nope', 0, 1)).rejects.toThrow('RESOURCE_NOT_FOUND');
  });
});

describe('freshness reflects staff confirmations only', () => {
  it('reserving and releasing does not make stale data look fresh', async () => {
    const age = async () => (await pool.query(
      `select extract(epoch from now() - updated_at)/60 as m from resources where hospital_id='H6' and type='icu_bed'`)).rows[0].m;
    expect(Number(await age())).toBeGreaterThan(80);             // H6 seeded 90 min stale
    const a = await newRequest();
    await reserve(a, 'H6');
    await pool.query('select cancel_request($1)', [a]);
    expect(Number(await age())).toBeGreaterThan(80);
  });
});

describe('control: the race test would catch a non-atomic implementation', () => {
  it('naive read-then-write reservation double-books under the same interleaving', async () => {
    // What a typical "check availability, then decrement" implementation does, step by step.
    const [a, b] = [await newRequest(), await newRequest()];
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('begin'); await c2.query('begin');
      const read = (c) => c.query(`select available from resources where hospital_id='H1' and type='icu_bed'`);
      const seen1 = (await read(c1)).rows[0].available;   // both see 1 free bed
      const seen2 = (await read(c2)).rows[0].available;
      expect([seen1, seen2]).toEqual([1, 1]);
      const take = async (c, req, seen) => {
        await c.query(`update resources set available = $1 where hospital_id='H1' and type='icu_bed'`, [seen - 1]);
        await c.query(`insert into reservations (request_id, hospital_id, resource_type) values ($1, 'H1', 'icu_bed')`, [req]);
      };
      await take(c1, a, seen1);
      await c1.query('commit');
      await take(c2, b, seen2);
      await c2.query('commit');
    } finally {
      c1.release(); c2.release();
    }
    expect(await holds('H1')).toBe(2);                    // two patients...
    expect(await available('H1', 'icu_bed')).toBe(0);     // ...for the one bed that was free
  });
});
