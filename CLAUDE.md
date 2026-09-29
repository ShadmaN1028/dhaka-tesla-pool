# Dhaka Tesla Pool: rules for Claude Code

Ride-pooling MVP for the RoBenDevs challenge. Deadline: Sept 30, 11:59 PM.
Scope is deliberately small. Correctness and clean git history matter more than features.

## Stack
- `/api`: Node.js + Express + TypeScript, Zod validation, Drizzle ORM (raw SQL allowed for the seat claim)
- `/web`: Next.js (App Router) + TypeScript, plain CSS or Tailwind, no animation libraries
- PostgreSQL 16 via docker compose
- Auth: bcrypt password hash, JWT in an httpOnly cookie, `role` = PASSENGER | DRIVER
- Tests: Vitest + Supertest against the real Postgres container (never mock the DB for pooling tests)

## Git rules (strict)
- Work ONLY on the current `feature/*` branch. Never commit to `master`, `pre-release`, or `release/*` directly.
- One logical change per commit. Format: `<type>(<scope>): <short description>`
  (types: feat, fix, refactor, test, docs, chore, build). Example: `feat(pool): enforce Bullet's seat capacity`
- Never use messages like "update", "changes", "fix", "final", "working now".
- Do not bundle multiple features into one commit. Stop and ask before touching files outside the current feature's scope.
- Never commit `.env` or secrets. Only `.env.example`.

## Story cast (use everywhere: seed, tests, README; never user1/driver1)
- Driver: Jashim, vehicle "Bullet", capacity 3
- Passengers: Nusrat, Rafiq, Shirin

## Geography
- `areas` table: Banani, Gulshan 1, Gulshan 2, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara
- `area_distances` table: symmetric, whole km. Must include:
  - Banani → Mohakhali = 3 km
  - Banani → Gulshan 1 = 2 km

## Fare model (money is ALWAYS integer paisa, never floats)
- `fare = 4000 (base) + 1500 × km`
- Pool discount: 20% off, applied when the ride has 2 or more passengers at the moment it STARTS. Use Math.round on the discount.
- Store `estimated_fare_paisa` (solo price, set at request) and `final_fare_paisa` (set at ride start).
- Worked example (must be a test):
  - Nusrat, Banani→Mohakhali pooled: 4000 + 4500 = 8500, minus 20% = **6800 paisa (68 BDT)**
  - Rafiq, Banani→Gulshan 1 pooled: 4000 + 3000 = 7000, minus 20% = **5600 paisa (56 BDT)**

## Two state machines
Ride request (per passenger):
`REQUESTED → MATCHED → IN_PROGRESS → COMPLETED`, plus `CANCELLED`
- Passenger may cancel only their own request, only in REQUESTED or MATCHED. Cancelling MATCHED releases seats atomically.

Ride (the Tesla trip / pool):
`OPEN → DRIVER_ARRIVED → STARTED → COMPLETED`, plus `CANCELLED` (driver, only before STARTED)
- When ride STARTED: all its MATCHED requests → IN_PROGRESS. When COMPLETED: they → COMPLETED.
- Any other transition is rejected with HTTP 409 and a clear error.
- Every transition of either machine inserts a row into `status_events` (entity type, entity id, from, to, actor user id, timestamp).
- Transition rules live in ONE module (e.g. `src/domain/stateMachine.ts`), not scattered in routes.

## Matching rule
1. Passenger creates a request (pickup area, destination area, seats 1–3) → REQUESTED.
2. System looks for an OPEN or DRIVER_ARRIVED ride with the same pickup area, created in the last 10 minutes, with enough free seats. If found, claim seats atomically → MATCHED (joins that pool).
3. If none, request stays REQUESTED and is visible to online drivers in that pickup area.
4. An online driver with no active ride accepts it → new OPEN ride on their vehicle, seats claimed → MATCHED.

## Concurrency (the core correctness rule)
- `rides` has `capacity` (copied from vehicle) and `seats_occupied`, with `CHECK (seats_occupied >= 0 AND seats_occupied <= capacity)`.
- Seat claim is ONE atomic statement, never read-then-write:
  `UPDATE rides SET seats_occupied = seats_occupied + $n WHERE id = $1 AND status IN ('OPEN','DRIVER_ARRIVED') AND seats_occupied + $n <= capacity RETURNING *`
  - No row returned → seat is gone → HTTP 409.
- Seat claim + request status change + status_event insert happen in one transaction.

## Authorization
- Passengers can read/modify only their own requests. They see their own fare and status only, never other passengers' fares.
- Drivers can act only on rides for their own vehicle.

## Required tests
1. Bullet's capacity can never be exceeded
2. Invalid state transitions are rejected
3. Nusrat's and Rafiq's pooled fares match the worked example
4. A user cannot modify another user's ride/request
5. Cancellation rules hold (and release seats)
6. Two concurrent claims for Bullet's last seat (Nusrat vs Shirin via Promise.all): exactly one succeeds, one gets 409

## Do not
- Add Redis, queues, microservices, websockets, map APIs, wallets, or ratings.
- Use floats for money.
- Write code I (Ove) haven't asked for in this session. When done, summarize what changed so I can review the diff.
