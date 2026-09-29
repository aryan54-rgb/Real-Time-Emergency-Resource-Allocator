# PulseRoute — verification run

- Date: 2026-09-29T03:43:14.098Z
- Node v20.20.2 · linux
- Result: **ALL PASSED**

| Step | Result | Time |
|---|---|---|
| Typecheck | PASS | 9.7s |
| Unit + database tests (vitest) | PASS | 13.1s |
| Production build | PASS | 38.5s |
| Availability simulator CLI (40 steps, seed 42) | PASS | 0.7s |
| HTTP race test (25 rounds, simulator running concurrently) | PASS | 1.7s |
| Invariant after concurrent simulation: 0 <= available <= total - held - occupied | PASS | -s |
| HTTP end-to-end flow | PASS | 0.6s |

## Typecheck

```
(no output)
```

## Unit + database tests (vitest)

```
RUN  v4.1.11 /mnt/d/ARYAN/hackmatrix/pulseroute


 Test Files  3 passed (3)
      Tests  35 passed (35)
   Start at  09:12:19
   Duration  10.62s (transform 148ms, setup 0ms, import 1.21s, tests 3.28s, environment 0ms)
```

## Production build

```
▲ Next.js 16.3.6 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 317ms

  Creating an optimized production build ...
✓ Compiled successfully in 5.6s
  Running TypeScript ...
  Finished TypeScript in 13.1s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/4) ...
  Generating static pages using 11 workers (1/4) 
  Generating static pages using 11 workers (2/4) 
  Generating static pages using 11 workers (3/4) 
✓ Generating static pages using 11 workers (4/4) in 921ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /ambulance/[id]
├ ƒ /api/hospitals/[id]/resources
├ ƒ /api/requests
├ ƒ /api/requests/[id]/cancel
├ ƒ /api/requests/[id]/handover
├ ƒ /api/requests/[id]/rank
├ ƒ /api/requests/[id]/reserve
├ ƒ /api/requests/[id]/respond
├ ƒ /api/state
├ ○ /dispatcher
└ ƒ /hospital/[id]


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

## Availability simulator CLI (40 steps, seed 42)

```
Availability simulator: seed 42, every 0 ms, 40 steps, excluding [H1:icu_bed]
#1 H4 trauma_team 2 -> 1 (admission) applied
#2 H6 cardiac_unit 1 -> 2 (discharge) applied
#3 H2 cardiac_unit 1 -> 0 (admission) applied
#4 H2 trauma_team 2 -> 1 (admission) applied
#5 H6 general_bed 40 -> 39 (admission) applied
#6 H2 icu_bed 3 -> 4 (discharge) applied
#7 H5 icu_bed 6 -> 5 (admission) applied
#8 H2 general_bed 20 -> 21 (discharge) applied
#9 H5 general_bed 30 -> 31 (discharge) applied
#10 H1 cardiac_unit 0 -> 1 (discharge) applied
#11 H6 cardiac_unit 2 -> 1 (admission) applied
#12 H4 trauma_team 1 -> 0 (admission) applied
#13 H2 trauma_team 1 -> 0 (admission) applied
#14 H2 general_bed 21 -> 22 (discharge) applied
#15 H4 general_bed 15 -> 14 (admission) applied
#16 H2 cardiac_unit 0 -> 1 (discharge) applied
#17 H4 cardiac_unit 2 -> 1 (admission) applied
#18 H2 ventilator 3 -> 2 (admission) applied
#19 H1 general_bed 12 -> 11 (admission) applied
#20 H4 icu_bed 4 -> 5 (discharge) applied
#21 H2 icu_bed 4 -> 5 (discharge) applied
#22 H2 general_bed 22 -> 21 (admission) applied
#23 H5 icu_bed 5 -> 6 (discharge) applied
#24 H4 general_bed 14 -> 13 (admission) applied
#25 H2 trauma_team 0 -> 1 (discharge) applied
#26 H1 trauma_team 1 -> 2 (discharge) applied
#27 H5 general_bed 31 -> 32 (discharge) applied
#28 H6 icu_bed 5 -> 4 (admission) applied
#29 H6 trauma_team 3 -> 2 (admission) applied
#30 H6 trauma_team 2 -> 1 (admission) applied
#31 H1 ventilator 2 -> 1 (admission) applied
#32 H3 icu_bed 0 -> 1 (discharge) applied
#33 H4 ventilator 5 -> 6 (discharge) applied
#34 H1 trauma_team 2 -> 1 (admission) applied
#35 H6 trauma_team 1 -> 0 (admission) applied
#36 H5 general_bed 32 -> 31 (admission) applied
#37 H4 general_bed 13 -> 14 (discharge) applied
#38 H1 ventilator 1 -> 2 (discharge) applied
#39 H4 icu_bed 5 -> 6 (discharge) applied
#40 H3 ventilator 1 -> 2 (discharge) applied
Stopped after 40 steps: 40 applied, 0 skipped (concurrent change), 0 capped.
```

## HTTP race test (25 rounds, simulator running concurrently)

```
Race test against http://localhost:3201: 25 rounds, 2 simultaneous requests for the last ICU bed at H1

  ✓ round 1: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 2: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 3: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 4: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 5: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 6: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 7: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 8: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 9: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 10: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 11: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 12: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 13: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 14: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 15: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 16: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 17: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 18: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 19: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 20: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 21: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 22: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 23: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 24: statuses [200,409] -> 1 success, 1 conflict, ICU left 0
  ✓ round 25: statuses [200,409] -> 1 success, 1 conflict, ICU left 0

ALL CHECKS PASSED
```

## Invariant after concurrent simulation: 0 <= available <= total - held - occupied

```
no violations across all hospitals/resources
resource rows changed by the simulator during the race: 24
```

## HTTP end-to-end flow

```
E2E flow against http://localhost:3201

  ✓ rejects unknown resource type with 400
  ✓ rejects malformed id with 400
  ✓ case created as pending
  ✓ ranked 6 hospitals
  ✓ reservable hospitals listed first
  ✓ non-reservable hospitals report what is missing
     top pick: H1 (score 0.98, ETA ~1 min)
  ✓ reserved at H1
  ✓ ICU count decremented by the hold
  ✓ other hospital cannot accept
  ✓ handover refused before acceptance
  ✓ hospital rejected, case back to pending
  ✓ rejection released the ICU bed
  ✓ rejecting hospital excluded on re-rank
  ✓ cannot re-reserve at rejecting hospital
  ✓ rerouted and reserved at H4
  ✓ hospital accepted
  ✓ patient handed over
  ✓ ICU bed stays occupied after handover
  ✓ handed-over case cannot be cancelled
  ✓ staff update based on a stale count is refused (409 STALE_COUNT)
  ✓ refused stale update left the count unchanged
  ✓ availability update is clamped to total
  ✓ active case still listed after 40 newer closed cases
  ✓ closed history is capped
  ✓ ranking works for that case
  ✓ reserve at unknown hospital -> 404
  ✓ out-of-range count -> 400

ALL CHECKS PASSED
```
