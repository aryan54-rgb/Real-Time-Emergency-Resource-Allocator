# PulseRoute — verification run

- Date: 2026-09-28T19:44:52.062Z
- Node v20.20.2 · linux
- Result: **ALL PASSED**

| Step | Result | Time |
|---|---|---|
| Typecheck | PASS | 11.2s |
| Unit + database tests (vitest) | PASS | 8.2s |
| Production build | PASS | 34.4s |
| HTTP race test (25 rounds) | PASS | 1.5s |
| HTTP end-to-end flow | PASS | 0.5s |

## Typecheck

```
(no output)
```

## Unit + database tests (vitest)

```
RUN  v4.1.11 /mnt/d/ARYAN/hackmatrix/pulseroute


 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  01:14:07
   Duration  5.88s (transform 98ms, setup 0ms, import 592ms, tests 1.17s, environment 0ms)
```

## Production build

```
▲ Next.js 16.3.6 (Turbopack)
- Environments: .env.local
✓ Running next.config.mjs took 282ms

  Creating an optimized production build ...
✓ Compiled successfully in 4.2s
  Running TypeScript ...
  Finished TypeScript in 9.9s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/4) ...
  Generating static pages using 11 workers (1/4) 
  Generating static pages using 11 workers (2/4) 
  Generating static pages using 11 workers (3/4) 
✓ Generating static pages using 11 workers (4/4) in 741ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
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

## HTTP race test (25 rounds)

```
Race test against http://localhost:3201: 25 rounds, 2 simultaneous requests for the last ICU bed at H1

  ✓ round 1: statuses [409,200] -> 1 success, 1 conflict, ICU left 0
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
