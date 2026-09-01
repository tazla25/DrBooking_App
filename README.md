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
| `mobile/` | Expo app (SDK 57, expo-router, TypeScript strict) — Phase 5+: design system, auth, patient screens. See `mobile/README.md`. |
| `mobile/app/` | expo-router routes (auth group, patient tabs, staff console tabs, admin placeholder, doctor detail, booking, live queue). |
| `mobile/src/` | theme tokens, Glass component kit, api client/session/errors/push, staff console lib + hooks, zustand auth store. |

## Stack (locked)

- **api/** — Next.js 16 (App Router, TypeScript), REST API routes only; no UI pages
- **mobile/** — Expo SDK 57 (Expo Go compatible), expo-router v57 (typed routes),
  React Native 0.86, TypeScript strict, zustand + expo-secure-store — **live from Phase 5**
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

## Mobile app (Phase 5+)

```bash
cd api && npm i && npx prisma db push && npx tsx prisma/seed.ts && npm run dev  # API on :3000

cd mobile
bun install                                  # standalone (not a workspace member)
cp .env.example .env.local                   # EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start   # scan with Expo Go
```

Gates (from `mobile/`): `npm run typecheck` · `npm run lint` · `npm test` (45 tests).
Design system: **glassmorphism pastel blue-purple** — full-screen gradient
`#BFD9F2 → #C7E3EC → #CBC6E8`, translucent glass cards, gradient pill CTAs,
status chips. Dev-only demo screen: `app/demo.tsx` (linked from Find Doctors / Profile).
Details: `mobile/README.md`.

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
| `RATE_LIMIT_*` | see `api/.env.example` | Override login/register/booking rate limits; `RATE_LIMIT_DISABLED=1` disables |
| `EXPO_ACCESS_TOKEN` / `FIREBASE_SERVER_KEY` | — | Push credentials (Expo works without a token; FCM is skipped without a key) |
| `PUSH_DISABLED` | `0` | `1` disables all push sends (auto-disabled in test) |

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
422 validation (zod) or malformed JSON · 429 login lockout or rate-limited · 500 internal.

**Auth:** `Authorization: Bearer <token>` — the token is returned once by
`POST /api/auth/login` and expires after 30 days.

### Endpoint summary (Phases 1–4)

Full request/response documentation lives in `api/README.md`. Summary:

| Phase | Area | Endpoints |
| --- | --- | --- |
| 1 (#1–5) | Auth | `POST /api/auth/register` · `login` · `logout` · `GET /api/auth/me` · `POST /api/auth/change-password` |
| 2 (#13–25) | Doctor/Compounder panel | `GET /api/queue/today` · `POST /api/queue/next` · `POST /api/appointments/walk-in` · `POST /api/appointments/:id/status` · schedule CRUD + overrides · `GET /api/patients` + notes · compounder provisioning · `PATCH /api/availability` |
| 3 (#6–12, 32–33) | Patient + public | `GET /api/doctors` (+`/:id`) · `GET /api/schedules/:id/availability` · `POST /api/appointments` · `GET /api/appointments/mine` · `POST /api/appointments/:id/cancel` · `GET /api/queue/:scheduleId/:date` · `POST /api/feedback` · `POST /api/devices` |
| 4 (#26–31) | Admin + analytics + hardening | `GET /api/admin/pending-doctors` · `POST /api/admin/verify-doctor` · `GET /api/admin/audit-log` · `GET /api/analytics/summary` · `GET /api/analytics/revenue` · `GET /api/export/appointments` (CSV, formula-injection-safe) · rate limiting · security headers · 404 catch-all · push service |

Smoke test (every contract #1–33 against the seeded dev DB):
`bash api/tests/smoke.sh` (API on `:3000`, re-runnable, exits non-zero on failure).

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

## Production (Phase 9 — Supabase + Vercel + EAS)

The system runs on three services. Nothing here needs a change to api/ or
mobile/ code — it is all configuration.

### 1. Database — Supabase Postgres

- Local dev + tests: **SQLite** (`api/prisma/schema.prisma`; jest recreates
  `api/db/test.db` every run). Production: **Supabase Postgres** via
  `api/prisma/schema.postgres.prisma` — a GENERATED copy (provider
  postgresql + `directUrl`), drift-checked byte-for-byte by
  `api/tests/schema-sync.test.ts`. Regenerate with
  `node api/scripts/sync-postgres-schema.mjs` after any schema change.
- **Which URL goes where** (Supabase → Connect): the **Transaction pooler
  (port 6543)** becomes `DATABASE_URL` — serverless Vercel functions open
  many short-lived connections, so runtime must go through pgbouncer
  (`?pgbouncer=true&connection_limit=1`). The **Session pooler (port 5432)**
  becomes `DIRECT_URL` — `prisma db push` DDL needs a direct session that
  pgbouncer's transaction mode cannot provide.
- **One-time migration + production seed** (exact commands, env-override
  pattern included): see `api/README.md` → "Production: Supabase Postgres
  migration". The production seed creates ONLY the SUPER_ADMIN bootstrap
  account (`SEED_PROFILE=production`) — never dev fixtures.

### 2. API hosting — Vercel

Project settings (dashboard; no `vercel.json` committed):

- **Root Directory**: `api` · Framework: Next.js (auto-detected)
- **Build Command override**:
  `npx prisma generate --schema prisma/schema.postgres.prisma && next build`
- **Install Command**: default (api/ has no lockfile)

Environment variables (Production + Preview), from `api/.env.example`:

| Var | Value |
| --- | --- |
| `DATABASE_URL` | transaction pooler URL + `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | session pooler URL |
| `DEFAULT_COUNTRY_CODE` | `91` |
| `RATE_LIMIT_DISABLED` / six `RATE_LIMIT_*` | values from `api/.env.example` |
| `PUSH_DISABLED` | `0` |
| `EXPO_ACCESS_TOKEN` | (empty — optional hardening) |
| `FIREBASE_SERVER_KEY` | (empty — legacy path unused) |

There is deliberately **no JWT secret** — sessions are opaque SHA-256 DB
tokens (`api/src/lib/auth.ts`); do not invent one.

**Re-deploy:** push/merge to `main` — Vercel auto-deploys (or hit
"Redeploy"). Verify after every deploy:

```bash
curl https://<project>.vercel.app/api/doctors                 # envelope ok:true
# POST /api/auth/login with the SUPER_ADMIN -> ok:true + token
# GET  /api/admin/pending-doctors with that Bearer token -> ok:true
```

Record the URL — it becomes `EXPO_PUBLIC_API_URL` in `mobile/eas.json`.

### 3. Mobile builds — EAS (Android)

- One-time: `EXPO_TOKEN=<token> npx eas-cli@latest init --non-interactive`
  (writes `extra.eas.projectId` into `app.json` — commit it; this is what
  makes push tokens work in the standalone APK).
- `mobile/eas.json` profiles: **preview** (installable APK, internal
  distribution, API URL pinned to the Vercel deployment — replace the
  placeholder before the first build) and **production** (Play-Store
  app-bundle, autoIncrement).
- Full owner runbook — build commands, EAS-managed keystore note, FCM v1
  push credential setup, and the 6-step on-device walkthrough — lives in
  `mobile/README.md` → "Production builds (Phase 9)".

### Secrets inventory + rotation

| Secret | Where it lives | Rotation |
| --- | --- | --- |
| Supabase DB password (inside both pooler URLs) | Supabase dashboard (reset); Vercel env vars; local `.env` (gitignored) | reset in Supabase → update the two pooler URLs in Vercel → redeploy |
| Expo access token (`EXPO_TOKEN`) | owner's shell / CI secret only — never in the repo | revoke + re-create at expo.dev → use the new token in the next `eas-cli` command |
| Firebase service-account JSON (FCM v1) | Expo project credentials (uploaded); file itself stays on the owner's machine | regenerate in Firebase → re-upload to expo.dev credentials |
| `EXPO_ACCESS_TOKEN` / `FIREBASE_SERVER_KEY` (API) | Vercel env vars — **intentionally empty** | leave empty unless adopting them later |

No JWT secret exists (nothing else to rotate). Secrets NEVER enter git: pooler
URLs with passwords, EXPO tokens and service-account JSON are all
gitignored/external by construction, and `mobile/.env*` stays gitignored.

### Backups & recovery

- **Supabase**: daily scheduled backups (Pro: also point-in-time recovery /
  PITR) — check Database → Backups in the Supabase dashboard for retention
  and restore. Prisma-level fallback: `pg_dump` the session pooler on the
  owner's schedule if the free tier's retention is insufficient.
- **API**: stateless (all state is the DB) — redeploy from git at any time.
- **Mobile**: the EAS-managed keystore is the irreplaceable asset (app
  updates for the same package id); inspect it with `npx eas-cli credentials`.
  It lives in Expo's credential store, never in the repo.

### Installing the APK on clinic devices

1. On the Android phone (8.0+): Settings → Security → allow **Install unknown
   apps** for the browser/file manager you will use (Chrome or Files).
2. Open the EAS build URL (from the `eas build` output / expo.dev → Builds)
   in the phone's browser and download the `.apk`.
3. Tap the download notification → **Install** → accept the warning
   (unknown source) → open **Dr Booking**.
4. Log in with the staff member's phone + password. Updates: repeat with the
   new APK URL — Android replaces the app in place, data stays.
## Roadmap

- **Done — Phase 1 (auth), Phase 2 (doctor/compounder panel), Phase 3 (patient
  booking + public queue), Phase 4 (admin verification, analytics, CSV export,
  push service, rate limiting, security headers, smoke tests), Phase 5 (mobile
  scaffold + glassmorphism design system + auth flow + Find Doctors), Phase 6
  (patient booking flow: availability, booking, my-appointments, live queue,
  feedback), Phase 7 (mobile staff console: Today queue + walk-ins + status
  machine, patient book + team notes, schedules + overrides, compounder
  management, availability toggle), Phase 8 (mobile SUPER_ADMIN console:
  verification queue, analytics + revenue chart, audit trail, CSV export,
  push deep-links + notification settings, audit polish).**
- **Done — Phase 9 (production launch):** Supabase Postgres migration path
  (generated + drift-checked `schema.postgres.prisma`, `SEED_PROFILE=production`
  bootstrap seed), Vercel deploy runbook, EAS build profiles (preview APK +
  production AAB), FCM v1 push credential setup, on-device walkthrough,
  handover/secrets/backup docs.**
- **Done — Phase 10 (UI polish):** real glassmorphism (low-alpha band so
  stacked panels stay translucent), radius unification law (22/16/14/12/16,
  pill reserved for true circles), owner brand assets (app icon, adaptive
  icon, splash, favicon, aurora wallpaper), blurred modal backdrops.**
- **Next — v1.1 backlog:** `DELETE /api/devices` (push deregistration on
  logout — see the known limitation in `mobile/README.md`), Redis-backed
  rate limiting behind a load balancer, Play Store release track.
