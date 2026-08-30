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
