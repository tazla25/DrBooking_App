# @dr-booking/api — REST API

Next.js 16 (App Router, TypeScript) — **REST API route handlers only, no UI
pages.** See the repository root `README.md` for architecture, conventions and
scripts. Quick reference:

```bash
bun run dev        # API on http://localhost:3000 (from repo root: bun run dev)
bun run test       # jest (own test DB — api/db/test.db)
bun run lint       # eslint
bun run db:seed    # re-seed dev DB (password for all seeded accounts: Test@1234)
```

## Auth endpoints (Phase 1)

All request/response bodies are JSON. Every response uses the standard
envelope: `{ ok: true, data }` | `{ ok: false, error: { code, message } }`.

### POST /api/auth/register

```jsonc
// request
{ "name": "Priya Nair", "phone": "9812345601", "password": "Secret@123", "role": "PATIENT" }

// 201
{ "ok": true, "data": { "user": { "id": "...", "phone": "+919812345601", "name": "Priya Nair",
  "role": "PATIENT", "verificationStatus": "VERIFIED", "mustChangePassword": false,
  "isActive": true, "delegatedDoctorId": null, "createdAt": "..." } } }
```

- `role`: `PATIENT` or `DOCTOR` only (COMPOUNDER/SUPER_ADMIN are provisioned, not self-served)
- DOCTOR signups start `verificationStatus: "PENDING"` (with a stub `DoctorProfile`)
- Phone accepted as 10-digit (`9812345601`), `0`-prefixed, `91`-prefixed or full
  `+91`/`+880` form — normalized to `+<cc>XXXXXXXXXX`
- `409 PHONE_EXISTS` when the phone is already registered; registration is audited

### POST /api/auth/login

```jsonc
// request
{ "phone": "9876543210", "password": "Test@1234" }

// 200
{ "ok": true, "data": { "token": "<64-hex, shown once>", "expiresAt": "...", "user": { ... } } }
```

- Wrong phone and wrong password are indistinguishable (`401 INVALID_CREDENTIALS`)
- 5 failures within 15 minutes → `429 ACCOUNT_LOCKED`
- Disabled account → `403 ACCOUNT_DISABLED`

### POST /api/auth/logout  (Bearer)

Revokes the caller's session → `{ "ok": true, "data": { "success": true } }`

### GET /api/auth/me  (Bearer)

→ `{ "ok": true, "data": { "user": { ... }, "doctorProfile": { "id", "fullName", "specialization" } | null } }`

### POST /api/auth/change-password  (Bearer)

```jsonc
// request
{ "currentPassword": "Test@1234", "newPassword": "NewSecret@123" }
```

- Clears `mustChangePassword` (completes compounder onboarding)
- Revokes every OTHER session; the caller's current session stays valid
- Audited as `AUTH_PASSWORD_CHANGED`

### GET /

Service status JSON (`service`, `version`, `todayIST`, `timeIST`).

## Error codes seen in Phase 1

`UNAUTHORIZED` · `INVALID_CREDENTIALS` · `ACCOUNT_LOCKED` · `ACCOUNT_DISABLED` ·
`PHONE_EXISTS` / `ALREADY_EXISTS` · `VALIDATION_ERROR` · `SAME_PASSWORD` ·
`FORBIDDEN` · `INTERNAL_ERROR`

## Doctor/Compounder panel endpoints (Phase 2, #13–25)

**Scoping law (fixes the v1 IDOR):** every route derives its doctor filter from
the authenticated caller — DOCTOR → own profile, COMPOUNDER → delegated doctor,
SUPER_ADMIN → null scope (may pass `?doctorId=` on read routes). A client-sent
`doctorId` is ALWAYS ignored for staff. A resource outside the caller's scope
answers **404** (existence is never revealed). PENDING/REJECTED doctors get
`403 DOCTOR_NOT_VERIFIED` on every route below. COMPOUNDER can do everything
except compounder management (DOCTOR-only).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/queue/today` | staff · admin | `?date=` (default today IST), admin needs `?doctorId=`; full patient contact (staff view); `estWaitMin` = (CONFIRMED\|CALLED ahead in same schedule+date) × `avgMinutesPerPatient` |
| POST | `/api/queue/next` | staff | One transaction: completes the current CALLED, calls next CONFIRMED → `{ completed, called, queueEmpty }` |
| POST | `/api/appointments/walk-in` | staff | Books a walk-in; `409 ALREADY_IN_QUEUE` (same phone+schedule+date, CONFIRMED/CALLED), `409 SCHEDULE_CLOSED`, `409 SCHEDULE_INACTIVE`; queue number race-safe (tx retry on P2002/P2034); fee defaults to doctor profile fee; audited `WALK_IN_CREATED` |
| POST | `/api/appointments/:id/status` | staff | State machine: CONFIRMED→CALLED/CANCELLED/NO_SHOW, CALLED→COMPLETED; everything else `409 INVALID_TRANSITION`; terminal states never resurrect; CANCELLED/NO_SHOW audited |
| GET | `/api/schedules` | staff · admin (read-only) | Includes inactive schedules; each row carries `todayOverride` + `todayQueueCount` (CONFIRMED+CALLED today); admin `?doctorId=` optional |
| POST | `/api/schedules` | staff | dayOfWeek 0–6, `HH:mm` with start < end, `avgMinutesPerPatient` 1–120; audited `SCHEDULE_CHANGED` |
| PUT | `/api/schedules/:id` | staff | Same validations; scoped 404 |
| DELETE | `/api/schedules/:id` | staff | **Soft delete only** (`isActive=false`) — appointment history survives; audited `SCHEDULE_CHANGED` |
| GET | `/api/schedules/:id/overrides` | staff · admin (read-only) | Calendar order |
| POST | `/api/schedules/:id/overrides` | staff | `CLOSED` must not carry times; `MODIFIED_HOURS`/`SPECIAL` require `newStartTime < newEndTime`; one per (scheduleId, date) → `409 OVERRIDE_EXISTS`; audited `OVERRIDE_CHANGED` |
| DELETE | `/api/schedules/:id/overrides/:date` | staff | Removes the override; audited `OVERRIDE_CHANGED` |
| GET | `/api/patients` | staff | Distinct patients by phone across the scoped doctor's appointments; `?q=` (name/phone contains, case-insensitive), `?page=&pageSize=` with real `total`; `totalVisits` excludes CANCELLED |
| GET | `/api/patients/:phone/notes` | staff | Team-shared notes (doctor + their compounders), newest first, author recorded |
| POST | `/api/patients/:phone/notes` | staff | `{ note (1–2000), isImportant? }`, author = caller; 201 |
| GET | `/api/compounders` | DOCTOR only | My delegated compounders (active + deactivated) |
| POST | `/api/compounders` | DOCTOR only | `{ name, phone }` → 201 with ONE-TIME `tempPassword` (12 chars, crypto-random; only the bcrypt hash is stored); `409 PHONE_EXISTS`; audited `COMPOUNDER_CREATED` |
| DELETE | `/api/compounders/:id` | DOCTOR only | Soft deactivate + revoke ALL sessions (login then → `403 ACCOUNT_DISABLED`); audited `COMPOUNDER_DEACTIVATED` |
| PATCH | `/api/availability` | staff | `{ isAvailableNow: boolean }` — DOCTOR toggles own profile, COMPOUNDER toggles the delegated doctor's |

### curl examples (seeded dev DB — password `Test@1234` for every account)

```bash
BASE=http://localhost:3000
# login as verified doctor 1 (+91 98765 43210)
TOKEN=$(curl -s $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"phone":"9876543210","password":"Test@1234"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# today's queue
curl -s "$BASE/api/queue/today" -H "authorization: Bearer $TOKEN"

# advance the queue (complete current, call next)
curl -s -X POST "$BASE/api/queue/next" -H "authorization: Bearer $TOKEN"

# walk-in booking (scheduleId from GET /api/schedules)
curl -s -X POST "$BASE/api/appointments/walk-in" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"scheduleId":"<SCHEDULE_ID>","date":"<TODAY_YYYY-MM-DD>","patientName":"Ravi Kumar","patientPhone":"9812345001"}'

# status transitions (legal: CONFIRMED→CALLED→COMPLETED; CONFIRMED→CANCELLED/NO_SHOW)
curl -s -X POST "$BASE/api/appointments/<ID>/status" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"CALLED"}'
curl -s -X POST "$BASE/api/appointments/<ID>/status" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"COMPLETED"}'
curl -s -X POST "$BASE/api/appointments/<ID>/status" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"CANCELLED"}'
```

### New error codes in Phase 2

`DOCTOR_NOT_VERIFIED` · `NOT_FOUND` (scoped 404) · `INVALID_TRANSITION` ·
`ALREADY_IN_QUEUE` · `SCHEDULE_CLOSED` · `SCHEDULE_INACTIVE` ·
`OVERRIDE_EXISTS` · `NO_DOCTOR_PROFILE` · `NO_DELEGATED_DOCTOR`

## Patient + public endpoints (Phase 3, #6–12 & 32–33)

All responses use the standard envelope. Public endpoints never expose patient
phones, patient ids, notes or fees; names on the public queue screen are masked
(`Priya Nair` → `P***r`).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/doctors` | — | VERIFIED doctors only. `?q=`, `?pinCode=`, `?sort=rating\|fee_asc\|fee_desc`, `?page=&pageSize=` |
| GET | `/api/doctors/:id` | — | Public profile + active schedules + overrides for the next 7 IST days. 404 unless VERIFIED. |
| GET | `/api/schedules/:id/availability?date=` | — | `{open, reason, capacityLeft, nextQueue, estWaitMin, …}`; `NOT_SCHEDULED_DAY` / `SCHEDULE_CLOSED` reasons. |
| POST | `/api/appointments` | PATIENT | Book `{scheduleId, date}`. Identity from the session only. 409 `CAPACITY_FULL` / `ALREADY_BOOKED` / `SCHEDULE_CLOSED`. 201 → `{appointment, position, estWaitMin}`. |
| GET | `/api/appointments/mine` | PATIENT | `?range=upcoming\|past`, paginated. |
| POST | `/api/appointments/:id/cancel` | PATIENT | Own CONFIRMED booking only → CANCELLED. |
| GET | `/api/queue/:scheduleId/:date` | — | Live queue screen (masked names, counts, optional `my` block when the caller has a booking in it). |
| POST | `/api/feedback` | PATIENT | `{appointmentId, rating 1–5, comment?}` on OWN COMPLETED appointment; one per appointment (409 `ALREADY_REVIEWED`); recomputes doctor `avgRating`/`reviewCount`. |
| POST | `/api/devices` | any role | Upsert `{token, platform}` device token for push. |

## Admin, analytics, export, push, hardening (Phase 4, #26–31)

### Admin endpoints (SUPER_ADMIN only — every other role gets 403)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/pending-doctors` | `role=DOCTOR AND verificationStatus=PENDING`, with DoctorProfile fields, oldest first. `?page=&limit=` → `{items,total,page,limit}`. |
| POST | `/api/admin/verify-doctor` | `{userId, decision: VERIFIED\|REJECTED, note?}`. Legal: PENDING→VERIFIED/REJECTED, REJECTED→VERIFIED (correction), VERIFIED→VERIFIED (idempotent), VERIFIED→REJECTED (suspension). REJECTED→REJECTED → 409. Status update + `AuditLog` row in ONE transaction (`DOCTOR_VERIFIED` / `DOCTOR_REJECTED`). 404 when the user is missing or not a doctor. |
| GET | `/api/admin/audit-log` | Newest first. `?page=&limit=&userId=&action=` (same pagination shape). `detail` is the raw JSON string as stored; `actor` is embedded for readability. |

A doctor rejected (suspended) via verify-doctor is immediately blocked from all
staff routes by the EXISTING `requireVerifiedStaff` gate (403
`DOCTOR_NOT_VERIFIED`) — no extra code on the staff routes.

### Analytics (DOCTOR own scope; SUPER_ADMIN must pass `?doctorId=<DoctorProfile.id>` — 422 otherwise; COMPOUNDER/PATIENT → 403)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/analytics/summary` | `{today, last7d, last30d}` each `{booked, completed, cancelled, noShow, walkIns, revenue}`. IST day windows `[today-6, today]` / `[today-29, today]`; revenue = sum of fee over COMPLETED (both sources); future appointments never count. |
| GET | `/api/analytics/revenue?days=30` | Daily `{date, count, revenue}` series of COMPLETED appointments, zero-filled, ascending, IST boundaries. `days` 1–365. |

### CSV export (DOCTOR own scope; SUPER_ADMIN `?doctorId=`; COMPOUNDER/PATIENT → 403)

`GET /api/export/appointments?from=&to=` — STREAMED `text/csv` attachment
(default range today-30 … today, IST). Columns:
`date,queueNumber,patientName,phone,doctorName,clinicName,status,source,fee`.
Success responses are raw CSV (not the JSON envelope); errors still use the
envelope.

**Formula-injection escape (old-repo bug #9):** every cell starting with
`=`, `+`, `-` or `@` is prefixed with `'` and CR/LF is stripped inside cells.
Note that phones are stored WITH the leading `+` (`+91…`), so phone cells are
deliberately escaped — that is the defense working, not a bug.

### Push notifications (`src/lib/push.ts`)

Env-guarded and failure-proof: `sendToUser` NEVER throws — unconfigured
providers, network failures and unexpected errors are logged and swallowed.
Call sites fire-and-forget AFTER the business transaction commits, so a push
failure can never roll back a booking/cancel/queue-advance. Triggers:

1. `POST /api/appointments` → patient gets **"Booking confirmed, token #N"**.
2. `POST /api/queue/next` → the CONFIRMED patient now 3rd in the remaining
   waiting line gets **"You're 3rd in queue"** (fewer than 3 waiting → no push).
3. Staff set `CANCELLED` via `/api/appointments/:id/status` → patient notified.
   Walk-ins without an account skip silently.

Token routing by shape: `ExponentPushToken[…]` → Expo push API
(`EXPO_ACCESS_TOKEN` optional); long plain tokens → FCM legacy endpoint
(`FIREBASE_SERVER_KEY` required, otherwise skipped with a log); anything else
is skipped. `PUSH_DISABLED=1` or `NODE_ENV=test` disables all sends.

### Rate limiting (`src/lib/rate-limit.ts`)

In-memory per-key sliding-window limiter (Map-based, no schema change):

| Rule | Key | Default | Env overrides |
| --- | --- | --- | --- |
| `POST /api/auth/login` | IP | 10 / minute | `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS` |
| `POST /api/auth/register` | IP | 5 / 15 minutes | `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_REGISTER_WINDOW_MS` |
| `POST /api/appointments` | user id | 20 / minute | `RATE_LIMIT_BOOKING_MAX`, `RATE_LIMIT_BOOKING_WINDOW_MS` |

Exceeding a limit → `429 RATE_LIMITED` (envelope + `Retry-After` header). The
limiter is bypassed entirely when `RATE_LIMIT_DISABLED=1` or `NODE_ENV=test`.

**Honest limitation (old-repo bug #8):** the counters live in the Node process
memory. This protects ONE API instance. Behind a load balancer with N
instances, each instance counts separately (effective limit ×N) because the
buckets are not shared. A global limiter needs Redis or a DB model — both are
deliberately out of stack in this phase (schema stays 0-lines-diff). The limiter
also trusts `X-Forwarded-For` for the client IP, which is only as trustworthy
as the proxy in front of the app.

### Security headers + 404 catch-all

`src/proxy.ts` (Next.js 16's name for the middleware convention — same file
Next 15 called `middleware.ts`) sets on EVERY response:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, plus
`Strict-Transport-Security` in production only. Any unmatched `/api/*` path
(including bare `/api`) returns the standard 404 envelope
`{ok:false,error:{code:'NOT_FOUND'}}` instead of an HTML error page.

### Smoke test

```bash
bun run db:seed && bun run dev     # terminal 1 (seeded dev DB + API on :3000)
bash tests/smoke.sh                # terminal 2 — 87 checks over every contract #1–33
SMOKE_BASE_URL=http://localhost:3000 bash tests/smoke.sh   # custom base URL
```

The script registers timestamp-unique accounts against a fresh schedule every
run (and presents a unique client IP to the per-IP limiter), so it is safely
re-runnable; it exits non-zero on the first failure.

## Production: Supabase Postgres migration (Phase 9)

Local dev and tests stay on **SQLite** (`prisma/schema.prisma` — jest's
global-setup recreates `db/test.db` every run). Production runs **Supabase
Postgres** via `prisma/schema.postgres.prisma`, which is **GENERATED** — never
hand-edit it:

```bash
node scripts/sync-postgres-schema.mjs   # or: bun scripts/sync-postgres-schema.mjs
```

The script copies `schema.prisma` verbatim and swaps only the datasource block
(`provider = "postgresql"` + `directUrl = env("DIRECT_URL")`).
`tests/schema-sync.test.ts` is the drift alarm: it re-applies the transform
in memory and asserts the committed copy matches **byte for byte** — so any
schema.prisma change MUST be committed together with the regenerated output
(both files in one commit, or CI fails).

Which Supabase URL goes where (from Supabase → Connect):

| Variable | Pooler | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | **Transaction** pooler | 6543 | app runtime (Vercel) + `prisma db seed` |
| `DIRECT_URL` | **Session** pooler | 5432 | `prisma db push` (DDL needs a direct session) |

Runtime runs through the transaction pooler (pgbouncer) because serverless
functions open many short-lived connections; DDL/seed through the session
pooler because pgbouncer's transaction mode cannot run multi-statement DDL.

### One-time migration runbook (exact commands)

```bash
cd api

# 1. Push the Postgres schema (DDL through the SESSION pooler):
DATABASE_URL="<TRANSACTION_POOLER_URL>?pgbouncer=true&connection_limit=1" \
DIRECT_URL="<SESSION_POOLER_URL>" \
npx prisma db push --schema prisma/schema.postgres.prisma

# 2. Generate the Postgres client for the deploy build (if testing locally):
npx prisma generate --schema prisma/schema.postgres.prisma

# 3. Seed production — ONLY the SUPER_ADMIN bootstrap account:
DATABASE_URL="<TRANSACTION_POOLER_URL>?pgbouncer=true&connection_limit=1" \
SEED_PROFILE=production npx prisma db seed

# 4. MANDATORY: restore the sqlite client so local dev/tests keep working:
npx prisma generate

# 5. Verify the admin row landed in Supabase (tiny node script):
DATABASE_URL="<TRANSACTION_POOLER_URL>?pgbouncer=true&connection_limit=1" \
node -e "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
db.user.findMany().then(u=>{console.log('users:',u.length,u.map(x=>x.role));return db.\$disconnect()})"
# expect: users: 1 [ 'SUPER_ADMIN' ]
```

The `DATABASE_URL`/`DIRECT_URL` **env-override pattern** (inline per command)
is deliberate: nothing production-related ever lands in `api/.env`, so local
SQLite can never be pointed at Supabase by accident. Real pooler URLs live
only in `.env` (gitignored) and the Vercel dashboard.

### SEED_PROFILE=production (seed.ts branch)

`SEED_PROFILE=production` makes `prisma/seed.ts` create **only** the
SUPER_ADMIN account (+91 99990 00001 / Test@1234) and return — upserted
idempotently, never wiping, never overwriting an already-rotated password.
No patient/doctor/compounder/appointment fixtures: fake appointments in a
real clinic queue are unacceptable. The guard (`isProductionSeed`) and the
branch (`seedProductionAdmin`) are exported and covered by
`tests/schema-sync.test.ts`. Without the env var the seed behaves exactly as
before (full dev fixtures, wipes first).
