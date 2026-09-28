// Shared helpers: apply migrations and seed simulated demo data.
// Used by `npm run db:migrate`, `npm run db:seed`, `npm run db:local` and the tests.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function migrate(client) {
  const dir = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(readFileSync(join(dir, file), 'utf8'));
  }
}

// 6 SIMULATED hospitals around Pune. Names are fictional; numbers are demo data only.
// `staleMin` backdates the last update so the freshness score has something to show.
export const DEMO_HOSPITALS = [
  { id: 'H1', name: 'Akurdi City Hospital (sim)', address: 'Akurdi, Pune', lat: 18.6479, lng: 73.7669, staleMin: 2,
    res: { icu_bed: [6, 1], general_bed: [40, 12], ventilator: [5, 2], trauma_team: [2, 1], cardiac_unit: [1, 0] } },
  { id: 'H2', name: 'Nigdi General (sim)', address: 'Nigdi, Pune', lat: 18.6573, lng: 73.7707, staleMin: 45,
    res: { icu_bed: [8, 3], general_bed: [60, 20], ventilator: [6, 3], trauma_team: [2, 2], cardiac_unit: [1, 1] } },
  { id: 'H3', name: 'Chinchwad Care Centre (sim)', address: 'Chinchwad, Pune', lat: 18.6298, lng: 73.7997, staleMin: 5,
    res: { icu_bed: [4, 0], general_bed: [30, 9], ventilator: [3, 1], trauma_team: [1, 1], cardiac_unit: [0, 0] } },
  { id: 'H4', name: 'Pimpri Heart & Trauma (sim)', address: 'Pimpri, Pune', lat: 18.6186, lng: 73.8037, staleMin: 1,
    res: { icu_bed: [10, 4], general_bed: [50, 15], ventilator: [8, 5], trauma_team: [3, 2], cardiac_unit: [2, 2] } },
  { id: 'H5', name: 'Wakad Multispeciality (sim)', address: 'Wakad, Pune', lat: 18.5987, lng: 73.7648, staleMin: 12,
    res: { icu_bed: [12, 6], general_bed: [80, 30], ventilator: [10, 6], trauma_team: [2, 1], cardiac_unit: [1, 1] } },
  { id: 'H6', name: 'Aundh District Hospital (sim)', address: 'Aundh, Pune', lat: 18.5590, lng: 73.8077, staleMin: 90,
    res: { icu_bed: [15, 5], general_bed: [120, 40], ventilator: [12, 4], trauma_team: [3, 3], cardiac_unit: [2, 1] } },
];

// Wipes all data and inserts the demo hospitals. H1 deliberately has exactly ONE free ICU bed
// so the double-booking demo is easy to reproduce.
export async function seed(client) {
  await client.query('begin');
  try {
    await client.query('delete from reservations');
    await client.query('delete from emergency_requests');
    await client.query('delete from resources');
    await client.query('delete from hospitals');
    for (const h of DEMO_HOSPITALS) {
      await client.query('insert into hospitals (id, name, address, lat, lng) values ($1, $2, $3, $4, $5)',
        [h.id, h.name, h.address, h.lat, h.lng]);
      for (const [type, [total, available]] of Object.entries(h.res)) {
        await client.query(
          `insert into resources (hospital_id, type, total, available, updated_at)
           values ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
          [h.id, type, total, available, h.staleMin]);
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}
