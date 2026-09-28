# PulseRoute — Technical Status (HLTH02)

Team Ignix · HackMatrix 5.0 · status as of 2026-09-29. All hospital data is simulated.

Reproduce every result below with one command: `npm run verify`. It uses its own throwaway database and writes `evidence/VERIFICATION.md`.

## 1. HLTH02 requirements vs implementation

| # | Requirement (from the HLTH02 brief) | Status | Where / how |
|---|---|---|---|
| R1 | Shared, up-to-date view of beds and other resources for ambulance teams and hospitals | **Done** | Dispatcher and hospital dashboards read one shared DB state. Live updates via 2 s polling (verified). Supabase Realtime is coded and hardened but **not yet verified on a real project** (see §3). |
| R2 | Maintain **simulated live** availability data | **Partial** | 6 simulated hospitals × 5 resource types, seeded with realistic staleness. Counts change through reservations and staff edits. There is no automatic simulator, so data doesn't change unless someone acts. See next step #1. |
| R3 | Rank destinations by resource match, travel time, data freshness | **Done** (travel time estimated) | `src/lib/ranking.ts`: `0.5·match + 0.35·travel + 0.15·freshness`. Hospitals missing a resource or that rejected the case go last. ETA uses straight-line distance × 1.35 at 30 km/h, with no routing API, and is labelled in the UI. |
| R4 | Hospital staff can accept or reject incoming requests | **Done** | `respond_to_request()`. Rejecting releases the held units and blocks that hospital for the case. Handover is confirmed separately. |
| R5 | Handle conflicting simultaneous requests and the strict double-booking case | **Done, verified** | `reserve_resources()`: a guarded atomic `UPDATE … WHERE available > 0`, locks taken in sorted order, all-or-nothing for multiple resources. The loser gets 409 and a re-ranked list; the dispatcher reroutes with one click (not automatic, see next step #3). |
| R6 | Architecture: Live Events → Concurrency-Safe State → Ranking → Dispatch UI → Hospital Confirmation | **Done** | See the README architecture section. |
| — | Suggested stack (Next.js, Redis Pub/Sub, WebSockets, MongoDB, Google Maps) | **Deviates by choice** | Next.js ✓. PostgreSQL/Supabase replaces MongoDB and Redis (transactions + row locks give the atomicity). Supabase Realtime replaces Redis Pub/Sub + WebSockets. Leaflet/OSM replaces Google Maps. **The Round 1 slides still describe Mongo/Redis/Google Maps and should be updated.** |

## 2. Fixed during this review

An independent code review plus targeted tests found these. All are fixed and covered by tests.

| Severity | Issue | Fix |
|---|---|---|
| **High** | **Double-booking via the hospital dashboard.** `+ / − / Confirm` wrote an *absolute* count from the staff member's screen. If a dispatcher reserved the last bed between screen refreshes, a stale click put the bed back and a second dispatcher could reserve it: 2 holds for 1 bed. Reproduced by a failing test before the fix. | Compare-and-set: staff updates carry the count they saw, and a stale update gets 409 `STALE_COUNT` and the screen refreshes (`0002_safe_availability_updates.sql`). |
| High | Active cases could disappear after ~100 newer cases (e.g. after a few race-test runs). Held beds then leaked, since no one could accept, reject or hand over. | Every active case is always returned; only closed history is capped (30). `/rank` looks the case up by id. |
| Medium | Reservations and releases bumped `updated_at`, making 90-min-stale data look fresh. | `updated_at` now means "last confirmed by staff"; the UI says **Last confirmed**. |
| Medium | Leaked polling interval on every page unmount in Realtime mode. | Unmount guard in `useLiveState`. |
| Medium | No safety net if Realtime silently stops delivering. | 15 s safety poll plus refresh on tab focus / network reconnect. |
| Medium | No pg pool `error` listener, so a dropped DB connection could crash the server mid-demo. | Listener added, plus connection/idle timeouts. |
| Low | Dashboard state read in 4 independent queries (could show inconsistent counts). | One repeatable-read snapshot. |
| Low | Unknown hospital / out-of-range numbers returned 500. | 404 / 400. Deadlock/serialization errors get 409 "retry". |
| Low | Supabase: write functions callable with the public anon key (RLS already made them no-ops). | `EXECUTE` revoked from anon; explicit `SELECT` grants for Realtime. |
| Low | Test scripts could modify a shared/remote database. | They refuse non-localhost targets unless `ALLOW_REMOTE_TESTS=1`. |

## 3. Verified tests and results

Latest `npm run verify` (2026-09-29, Node 20, local PostgreSQL 18 + production build):

| Suite | Result | What it proves |
|---|---|---|
| Typecheck | PASS | — |
| Unit + database tests (`npm test`) | **26/26 pass** | Two simultaneous requests for H1's last ICU bed: exactly one wins, the loser stays `pending` and can be rerouted. A forced lock interleaving. 20 requests for 4 beds → exactly 4 win. One case racing at 2 hospitals. All-or-nothing multi-resource. No deadlock with opposite need orders. Lifecycle guards. Stale-count regression (4 tests, including 20 concurrent staff-vs-dispatcher rounds). Freshness unaffected by reservations. 8 ranking/geo unit tests. |
| **Control test** | PASS | A naive "read, then decrement" implementation under the same interleaving **does** double-book (2 holds, 1 bed). The race tests are sensitive enough to catch a real bug. |
| Production build | PASS | — |
| HTTP race test (`npm run test:race`) | **25/25 rounds** | Two simultaneous `POST /reserve` for the last ICU bed → exactly one 200 and one 409 every round, 0 beds left. |
| HTTP end-to-end (`npm run test:e2e`) | **28/28 checks** | Create → rank → reserve → wrong hospital refused → reject → release → re-rank → reroute → accept → handover → bed stays occupied. Also: stale staff update refused, clamping, active-case visibility under 40 closed cases, input validation (400/404). |
| Browser (Playwright, headless Chromium; run manually) | PASS | Two dispatcher windows click Reserve on H1's last ICU bed simultaneously → one "Reserved", one "just taken, re-ranked". Hospital accepts → handover → dispatcher updates without reload. A stale hospital "+" is refused and the screen refreshes. Screenshots in `evidence/screenshots/`. |
| **Supabase Realtime** (`npm run test:realtime`) | **NOT RUN** | No Supabase project was available. Local Supabase needs Docker, which isn't running here. The script is ready: it checks anon read, anon write blocked, anon RPC refused, and Realtime event delivery + latency. |

Numbers above are functional test results on one laptop, not performance benchmarks.

## 4. Known limitations

- **Realtime is unverified.** Until `npm run test:realtime` passes on a real project, demo with polling (2 s). The badge shows which mode is active.
- **No automatic availability simulation** (R2 is partial).
- **Travel time is an estimate**, with no routing or traffic data.
- **Reservation holds never expire.** An unanswered request keeps its units until the dispatcher cancels.
- **Rerouting after a conflict is manual.** It takes one click on the re-ranked list.
- **No authentication or roles.** Any visitor can open any hospital's dashboard. With Supabase, the anon key can **read** all tables (fine for simulated data only).
- **Beds occupied after handover are never released automatically.** Staff free them with "+".
- The ranking weights are demo defaults, not clinically validated. Severity is recorded but not used in ranking.
- On WSL with the project on a Windows drive, `next dev` does not hot-reload.

## 5. Recommended next steps (not implemented; ranked by value for the remaining time)

1. **Availability simulator (closes R2), ~1 h.** Add `npm run simulate`: every few seconds, randomly admit or discharge ±1 at a random hospital through the existing compare-and-set function, and occasionally "confirm" counts. The dashboards then move on their own, which is also good for the demo video.
2. **Verify Realtime + deploy, ~1 h.** Create a free Supabase project: `npm run db:reset` → `npm run test:realtime` → deploy to Vercel. Use the transaction pooler (port 6543) for `DATABASE_URL` on serverless. This gives a public demo URL and turns the one unverified claim into evidence.
3. **"Reserve next best" after a conflict, ~45 min.** When a reserve returns 409, offer, or automatically try, the next reservable hospital. This matches the brief's "the other is safely rerouted" wording. Reuses the existing endpoint.
4. **Hold expiry, ~1 h.** Holds older than N minutes without a hospital response are released (lazy `expire_holds()` called from reserve/state), with a DB test. This removes the stuck-bed limitation.
5. **Align the pitch deck with the build, ~30 min.** Update slides 4, 5 and 7 (stack, architecture diagram, references) and add the real evidence: test counts and screenshots from `evidence/`.

## 6. Demo scenarios to record

1. **Happy path (~60 s).** Create an ICU case near Akurdi → explain the ranking columns (match / ETA / data age / score) → Reserve → switch to the hospital screen → Accept → Confirm handover → the dispatcher screen updates without reload.
2. **Double-booking, the key scenario (~45 s).** Two dispatcher windows side by side, two ICU cases, both click Reserve on H1 (1 free ICU bed) at once → one "Reserved", the other "just taken", with H1 dropping to "Missing: ICU bed". Cut to a terminal running `npm run test:race` (25/25).
3. **Reject → reroute (~40 s).** The hospital rejects with a note → the bed is released → the case returns with "Rejected by H1" → reserve the next-ranked hospital.
4. **Freshness (~30 s).** Point out the stale flag on H2 (45 min) and H6 (90 min) → press Confirm on H6's ICU row → its data age resets and its rank rises.
5. **Stale-screen protection (~30 s).** The hospital screen shows 1 ICU bed → a dispatcher reserves it → staff click "+" → "That count changed…" and the screen shows 0.
6. **Multi-resource all-or-nothing (~20 s).** An ICU + Cardiac unit case → H1 shows "Missing: Cardiac unit" and can't be reserved; H4 can.
7. **Evidence (~20 s).** `npm run verify` finishing with ALL PASSED, and `evidence/VERIFICATION.md`.
