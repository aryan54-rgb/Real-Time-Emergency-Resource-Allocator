# PulseRoute — HLTH02 Real-Time Emergency Resource Allocator (MVP)

HackMatrix 5.0 · Team Ignix. A basic working MVP: dispatchers see live (simulated) hospital
resources, get hospitals ranked for each case, and reserve resources atomically. Hospital staff
accept or reject and confirm patient handover.

> All hospital data is **simulated**. Not for clinical use. There is no AI and no auth in this MVP.

## Features

| Area | What works |
|---|---|
| Live availability | 6 simulated hospitals × 5 resource types (ICU bed, general bed, ventilator, trauma team, cardiac unit). Hospital staff adjust or confirm counts; this sets the resource's "last confirmed" time, which drives freshness. Staff updates are compare-and-set, so a click based on a stale screen is refused (409 `STALE_COUNT`) and cannot re-open a reserved bed. |
| Real-time sync | Supabase Realtime (`postgres_changes`) pushes DB changes to every open dashboard, with a 15 s safety poll. Without Supabase keys it falls back to polling every 2 s. The badge in the top-right shows which mode is active. **Realtime has not yet been verified on a real project**; run `npm run test:realtime`. |
| Ranking | `score = 0.5·match + 0.35·travel + 0.15·freshness`. **match** is the share of the needed resources available; **travel** comes from an estimated ETA; **freshness** halves every 15 min. Hospitals that can't fully serve the case, or that already rejected it, are listed last and can't be reserved. |
| Map | Leaflet + OpenStreetMap. Markers are coloured by free ICU beds. Click the map to place a case. Lines show reserved (dashed) and accepted cases. |
| Dispatch flow | create case → rank → **reserve** → hospital **accepts/rejects** → **handover**. A rejection frees the resources, and the dispatcher picks the next hospital. The dispatcher can cancel at any time before handover. |
| Double-booking prevention | `reserve_resources()` in Postgres uses an atomic `UPDATE … WHERE available > 0`, with row locks and all-or-nothing for multi-resource cases. It also has a `CHECK (available >= 0)` backstop. |

## Architecture

```
Browser (Next.js pages)                         Next.js server (route handlers)            PostgreSQL / Supabase
  /dispatcher  ─ fetch /api/state ───────────▶   GET  /api/state                ── pg ──▶  hospitals, resources,
  /hospital/H1 ─ POST /api/requests/:id/... ─▶   POST reserve|respond|handover|…  ──────▶  emergency_requests, reservations
       ▲                                                                                   SQL functions (atomic)
       └──── Supabase Realtime (postgres_changes) ◀──────────────────────────────────────  supabase_realtime publication
```

- All writes go through the server, which calls SQL functions in `supabase/migrations/0001_init.sql`. Each state transition is one guarded `UPDATE` (e.g. only a `reserved` request can be accepted, and only by its hospital).
- The browser only **reads** via Realtime. Row-level security (RLS) gives the anonymous key read-only access.

Request lifecycle: `pending → reserved → accepted → handed_over`. A rejection takes `reserved` back to `pending`. `pending`, `reserved` and `accepted` can go to `cancelled`.

## Setup

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env.local
```

### Option A: fully local (no Supabase account, no Docker)

Uses a real embedded PostgreSQL. Realtime falls back to 2-second polling.

```bash
# terminal 1: starts Postgres on :54329, applies the schema, seeds demo data (Ctrl+C to stop)
npm run db:local

# terminal 2
npm run dev            # http://localhost:3000
```

The default `DATABASE_URL` in `.env.example` already points at this database.

### Option B: Supabase (with Realtime push)

1. Create a Supabase project.
2. In `.env.local`, set:
   - `DATABASE_URL`: Project Settings → Database → connection string (Session pooler).
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings → API.
3. Apply the schema and seed. Alternatively, paste `supabase/migrations/0001_init.sql` into the SQL editor and then run `npm run db:seed`.
   ```bash
   npm run db:reset       # migrate + seed
   ```
4. `npm run test:realtime`: checks anon read access, that anon cannot write or call the write functions, and that change events arrive (with latency).
5. `npm run dev`. The badge should read **Live · Supabase Realtime**.

If you deploy to a serverless host (e.g. Vercel), use the Supabase **transaction pooler** (port 6543) for `DATABASE_URL`.

The migration enables RLS with read-only policies and adds the tables to the `supabase_realtime` publication. These steps are skipped automatically on plain Postgres.

### Demo data

`npm run db:seed` (or `db:reset`) wipes all cases and restores the 6 simulated hospitals:

- **H1** has exactly **one free ICU bed**, for the double-booking demo.
- **H3** has no free ICU beds.
- **H2** and **H6** have deliberately stale data (45 and 90 min old), so the freshness penalty is visible.

## Demo script (2 minutes)

1. Open `/dispatcher` in **two** browser windows and `/hospital/H1` in a third.
2. In each dispatcher window, click near H1 on the map, tick **ICU bed**, and create a case.
3. Click **Reserve** on *Akurdi City Hospital (H1)* in both windows at about the same time. One succeeds. The other gets *"That resource was just taken…"*, H1 drops to "Missing: ICU bed", and the next hospital becomes the top pick.
4. In the H1 window, the reservation appears under **Incoming requests**. Click **Accept**, then **Confirm patient handover**. Both dispatcher windows update on their own.
5. Try **Reject** on another case: the bed is released, and that hospital can't be reserved again for that case.

## Tests

```bash
npm run verify         # EVERYTHING in one go, isolated: typecheck, unit/DB tests, production build,
                       # then race + e2e against a throwaway Postgres and server -> evidence/VERIFICATION.md

npm test               # unit + database tests (starts its own throwaway Postgres; no setup needed)
npm run typecheck

# API-level tests. Need a running server with seeded data (npm run db:local + npm run dev):
npm run test:race      # 10 rounds: 2 simultaneous reserves for H1's last ICU bed -> exactly 1 x 200, 1 x 409
npm run test:e2e       # full flow: create, rank, reserve, reject, reroute, accept, handover, error cases
# point at another server with BASE_URL=http://host:port, change the rounds with ROUNDS=50
# these create cases and change counts: they refuse non-localhost servers unless ALLOW_REMOTE_TESTS=1

npm run test:realtime  # Supabase only: RLS read/write checks + Realtime delivery and latency
```

What `npm test` covers (`tests/`):

- **`reservations.test.mjs`**, against real Postgres:
  - two simultaneous requests for the last ICU bed (exactly one wins; the loser stays `pending` and can be rerouted)
  - a forced interleaving where the second transaction blocks on the row lock and then fails
  - 20 concurrent requests for 4 beds (exactly 4 win)
  - one request racing at two hospitals
  - all-or-nothing multi-resource reservations
  - no deadlock when two cases list the same resources in opposite orders
  - reject/accept/handover/cancel rules
  - clamping of availability updates
  - regression: a stale hospital-screen update can't re-open a reserved bed (including 20 concurrent staff-vs-dispatcher rounds)
  - reservations don't make stale data look fresh
  - **control test**: a naive read-then-write reservation *does* double-book under the same interleaving, which shows the race tests can catch the bug
- **`ranking.test.ts`**:
  - nearer hospital wins when all else is equal
  - hospitals missing a resource are never ranked above ones that have it
  - partial matches score by the share of needs available
  - fresher data wins, and old data is flagged stale
  - hospitals that rejected the case are excluded
  - scores stay within 0..1

## Project layout

```
supabase/migrations/0001_init.sql   schema, atomic SQL functions, RLS + realtime (Supabase only)
supabase/migrations/0002_*.sql      compare-and-set staff updates, Supabase grants/revokes
scripts/verify.mjs                  one-command verification -> evidence/VERIFICATION.md
scripts/realtime-check.mjs          Supabase Realtime/RLS check
evidence/                           verification report + UI screenshots
TECHNICAL_STATUS.md                 requirements, test evidence, limitations, next steps
scripts/db-local.mjs                embedded Postgres for local dev
scripts/db-cli.mjs, db-tools.mjs    migrate / seed (demo hospitals live in db-tools.mjs)
scripts/race-test.mjs, e2e-test.mjs HTTP-level tests
src/lib/ranking.ts                  ranking engine (pure function)
src/lib/db.ts, api.ts               server DB access + error mapping (SQL errors -> 409)
src/lib/useLiveState.ts             Supabase Realtime subscription with polling fallback
src/app/api/**                      route handlers
src/app/dispatcher, hospital/[id]   dashboards
```

## Known limitations (deliberately out of scope for the MVP)

- **Travel time is an estimate:** straight-line distance × 1.35 at 30 km/h. There is no routing or traffic API yet.
- **No hold expiry:** if a hospital never responds, the units stay held until the dispatcher cancels.
- **No authentication:** anyone can open any hospital's dashboard. With Supabase, the anon key can read all tables (simulated data only).
- **No automatic availability simulation:** counts change only through reservations and staff edits.
- **Manual reroute:** after a conflict the dispatcher picks the next hospital (one click).

See `TECHNICAL_STATUS.md` for the full status.
- **WSL note:** if the project sits on a Windows drive (`/mnt/c`, `/mnt/d`), `next dev` may not notice file edits. Restart it, or keep the project on the Linux filesystem.
