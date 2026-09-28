// Demo availability simulator. Start: `npm run simulate`. Stop: Ctrl+C. The app works identically
// without it; it only changes counts through the same safe DB function hospital staff use.
//
// Env (all optional):
//   SIM_SEED=42            same seed + freshly seeded data (`npm run db:seed`) => same run
//   SIM_INTERVAL_MS=4000   pause between changes
//   SIM_STEPS=             stop after N changes (default: run until Ctrl+C)
//   SIM_EXCLUDE=H1:icu_bed comma list of "Hx:type" or "Hx" to leave alone ("" = none)
import pg from 'pg';
import { parseExclude, runSimulator } from './simulator-core.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const seed = Number(process.env.SIM_SEED ?? 42);
const intervalMs = Number(process.env.SIM_INTERVAL_MS ?? 4000);
const steps = process.env.SIM_STEPS ? Number(process.env.SIM_STEPS) : Infinity;
const exclude = parseExclude(process.env.SIM_EXCLUDE);

const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await db.connect();

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

console.log(`Availability simulator: seed ${seed}, every ${intervalMs} ms, ${Number.isFinite(steps) ? `${steps} steps` : 'until Ctrl+C'}, excluding [${exclude.join(', ') || 'nothing'}]`);
const history = await runSimulator(db, { seed, steps, intervalMs, exclude, signal: controller.signal, log: (m) => console.log(m) });
const count = (o) => history.filter((h) => h.outcome === o).length;
console.log(`Stopped after ${history.length} steps: ${count('applied')} applied, ${count('stale')} skipped (concurrent change), ${count('no_change')} capped.`);
await db.end();
