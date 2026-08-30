# Dr_Booking App v2

Clinic appointment booking platform for India. A ground-up rebuild of the old
WhatsApp-bot system as a native mobile app + REST API. **Fresh code, no
carried-over logic.**

- **Branch:** `v2/foundation` (Phase 1 — foundation)
- **Status:** Phase 1 complete (monorepo, data model, auth core, seed, tests)

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────────┐
│  mobile/ (Expo)     │  HTTP  │  api/ (Next.js 16 App Router)│
│  Expo SDK 52+       │ ─────► │  REST API routes only        │
│  Expo Router        │  JSON  │  TypeScript, no UI pages     │
│  React Native + TS  │        └──────────────┬───────────────┘
└─────────────────────┘                       │ Prisma ORM
                                              ▼
                                   ┌─────────────────────────┐
                                   │  SQLite (dev)           │
                                   │  Postgres/Supabase (prod)│
                                   └─────────────────────────┘
```

**Monorepo layout**

| Path | Purpose |
| --- | --- |
| `api/` | REST API — Next.js 16 (App Router, TypeScript). API route handlers only, no UI pages. |
| `api/prisma/` | Prisma schema + seed. Shared by dev (SQLite) and prod (Postgres/Supabase). |
| `api/src/lib/` | Shared server libraries: time (IST), errors, validation, auth, RBAC. |
| `api/src/app/api/` | REST endpoints (one folder per resource). |
| `api/tests/` | Jest suites (route-handler level — no HTTP server needed). |
| `mobile/` | Expo placeholder (Phase 2+). |

## Stack (locked)

- **api/** — Next.js 16 (App Router, TypeScript), REST API routes only; no UI pages
- **mobile/** — Expo SDK 52+, Expo Router, React Native, TypeScript (placeholder this phase)
- **DB** — Prisma ORM. Schema at `api/prisma/schema.prisma`. SQLite for local dev,
  Postgres (Supabase) for prod → **no Prisma `enum` / `String[]` / `Json` types**
  (all enumerated values are plain `String` columns validated by zod at the boundary)
- **Auth** — phone + password (bcryptjs, 10 rounds). Opaque bearer token:
  32-byte crypto-random, DB stores only `SHA-256(token)` (`Session.tokenHash`),
  verified with a constant-time compare
- **Validation** — zod on every request body + query

## Getting started

```bash
bun install            # installs the workspace (root + api/)
bun run db:push        # create/sync the SQLite dev database
bun run db:seed        # seed dev data (see below)
bun run dev            # start the API on http://localhost:3000
```

Verify: `curl http://localhost:3000/` → `{"ok":true,"data":{"service":"dr-booking-api",...}}`

### All scripts (run from the repo root)

| Script | What it does |
| --- | --- |
| `bun run dev` | Start the API dev server (port 3000) |
| `bun run lint` | ESLint (api/) |
| `bun run typecheck` | `tsc --noEmit` (api/) |
| `bun run test` | Jest suite (uses its own `api/db/test.db`, never touches dev data) |
| `bun run db:push` | Push Prisma schema to the dev DB |
| `bun run db:seed` | Re-seed the dev DB (wipes existing rows) |
| `bun run db:generate` | Regenerate the Prisma client |

### Environment (`api/.env`, see `api/.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:../db/custom.db` (relative to `api/prisma/`) | SQLite (dev) / Postgres URL (prod) |
| `DEFAULT_COUNTRY_CODE` | `91` | Dial code used to normalize 10-digit phone numbers |

No secrets live in client code — all keys are server-side only.

## API conventions

**Response envelope (every endpoint, no exceptions):**

```jsonc
// success
{ "ok": true, "data": { /* ... */ } }

// failure
{ "ok": false, "error": { "code": "MACHINE_READABLE_CODE", "message": "Human text" } }
```

**Status codes:** 200 / 201 success · 401 unauthenticated or bad credentials ·
403 wrong role / not verified · 404 missing · 409 conflict (e.g. `PHONE_EXISTS`) ·
422 validation (zod) or malformed JSON · 429 login lockout · 500 internal.

**Auth:** `Authorization: Bearer <token>` — the token is returned once by
`POST /api/auth/login` and expires after 30 days.

### Phase 1 endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/` | — | Service status (JSON) |
| POST | `/api/auth/register` | — | PATIENT/DOCTOR self-signup. DOCTOR starts `PENDING`. 409 if phone exists. Audited. |
| POST | `/api/auth/login` | — | Phone + password → bearer token. 5 failures/15 min → 429 lockout. |
| POST | `/api/auth/logout` | Bearer | Revokes the current session. |
| GET | `/api/auth/me` | Bearer | Current user (safe fields + doctor profile when linked). |
| POST | `/api/auth/change-password` | Bearer | Change password; clears `mustChangePassword`, revokes other sessions. |

## Engineering rules (non-negotiable)

1. **Timezone** — business dates are `'YYYY-MM-DD'` strings and times `'HH:mm'`,
   always in **Asia/Kolkata**. "Today" comes ONLY from
   `istTodayISO()` (`api/src/lib/time.ts`, via `Intl.DateTimeFormat`) —
   **never** `toISOString()` for business logic.
2. **RBAC** — server-side `requireAuth([roles])` on every non-public route.
   DOCTOR and COMPOUNDER data access is scoped by `getDoctorScope()`
   (`{ doctorId }`, or `null` for SUPER_ADMIN). A client-sent `doctorId` must
   never override the server-side scope. COMPOUNDER inherits the delegated
   doctor's scope (`User.delegatedDoctorId`).
3. **Response shape** — the envelope above, everywhere, with proper 401/403/404/409/422.
4. **No secrets in client code.** No WhatsApp/Telegram code anywhere in the repo.
5. **Plain String status values** — appointment: `CONFIRMED | CALLED | COMPLETED |
   CANCELLED | NO_SHOW`; roles: `PATIENT | DOCTOR | COMPOUNDER | SUPER_ADMIN`.
   Allowed values are enforced by zod at the API boundary and documented in the schema.

## Old-system bugs — and how v2 prevents them

| v1 bug | v2 fix |
| --- | --- |
| OTP/secrets sent to the requester | No OTP flows; tokens are returned only to the authenticated caller; hashes never leave the server |
| Client `doctorId` overriding server scope | Scope is derived ONLY from the authenticated user (`getDoctorScope`); client-sent ids are ignored |
| Wrong scope helper on Doctor/Feedback models | One scope helper (`src/lib/rbac.ts`) used by all clinical routes |
| Mixed UTC/IST date math | Single source of truth: `src/lib/time.ts` (Intl, Asia/Kolkata); no `toISOString()` business logic |
| Check-then-insert without transaction | Register/change-password run in `prisma.$transaction`; unique-violation races map to 409 |
| Hardcoded fallback secrets | No fallback secrets; env-only config (`api/.env`, gitignored; `.env.example` documents keys) |

## Phase 1 data model (summary)

`User` · `DoctorProfile` · `Schedule` · `ScheduleOverride` · `Appointment` ·
`Feedback` · `PatientNote` · `Session` · `DeviceToken` · `AuditLog` · `FailedLogin`

Relations cascade where the parent owns the child (User→DoctorProfile, Doctor→
Schedule→Appointment, Appointment→Feedback, User→Session) and `SetNull` where a
reference is optional (Appointment.patient, PatientNote.author, AuditLog.actor,
User.delegatedDoctor, ScheduleOverride.createdBy). Full definitions and the
allowed string values live in `api/prisma/schema.prisma`.

## Seeded accounts (dev only — password `Test@1234`)

| Role | Phone | Notes |
| --- | --- | --- |
| SUPER_ADMIN | +91 99990 00001 | |
| DOCTOR (VERIFIED) | +91 98765 43210 | Dr. Ananya Sharma — schedules include today |
| DOCTOR (VERIFIED) | +91 98765 43211 | Dr. Rohan Mehta — schedules include today |
| DOCTOR (PENDING) | +91 98765 43299 | awaiting verification |
| COMPOUNDER | +91 98765 43220 | `mustChangePassword=true`, delegated to doctor 1 |
| PATIENT ×5 | +91 98123 45601…605 | sample appointments today |

## Roadmap

- **Phase 2 (next):** doctor verification (SUPER_ADMIN), schedule CRUD with
  overrides, appointment booking with queue numbers + transactions, doctor dashboards.
- **Phase 3:** patient search/notes, feedback endpoints, notifications (DeviceToken).
- **Phase 4:** mobile app (Expo), Postgres/Supabase migration, deployment.
