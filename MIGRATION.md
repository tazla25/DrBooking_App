# Phase 11 Deployment — Owner Runbook

**Scope**: Doctor identity (`registrationNumber`, `avatarUrl` on `DoctorProfile`) +
manual appointment confirmation (`PENDING` status). The database change is
**purely additive**: two new nullable columns on `DoctorProfile`; the
`Appointment.status` column is a plain String that already accepts the new
`PENDING` value — **no column change, no data change**. Only NEW online
bookings get `PENDING`; existing rows keep their stored statuses.

You (the owner) run every command below yourself. The agent never connects to
the production database.

---

## 1. Pre-flight (any machine with the repo)

```bash
git clone https://github.com/tazla25/DrBooking_App.git   # or git fetch && git checkout main
cd DrBooking_App
git log --oneline -1   # confirm you are on the merged Phase 11 merge commit
```

Sanity: `api/prisma/schema.prisma` shows `registrationNumber String?` and
`avatarUrl String?` on `model DoctorProfile`, and `api/src/lib/validation.ts`
lists `'PENDING'` first in `APPOINTMENT_STATUSES`.

## 2. Regenerate the Prisma client + the Postgres schema file (local, no DB access)

These two commands only regenerate artifacts in the repo — they touch no
database:

```bash
cd api
bun install
bun run db:generate                                    # prisma generate (SQLite dev schema)
node scripts/sync-postgres-schema.mjs                  # regenerates prisma/schema.postgres.prisma
git diff --stat prisma/                                # should show NO changes (already committed)
```

If `git diff` is empty, the committed artifacts are current — nothing to do.
(If it is not empty, stop and reconcile before continuing.)

## 3. Apply the additive schema to the Supabase Postgres prod DB

Use the **session pooler / direct URL** (`DIRECT_URL`, port 5432) for schema
changes, from your own machine with the real credentials in `api/.env`:

```bash
cd api
DATABASE_URL="<SUPABASE_TRANSACTION_POOLER_URL>" \
DIRECT_URL="<SUPABASE_SESSION_POOLER_URL>" \
bunx prisma db push --schema prisma/schema.postgres.prisma --accept-data-loss
```

Expected output: `2 columns added to DoctorProfile` (or `Your database is
already in sync` if re-run). Nothing is dropped or altered — the `db push`
plan must ONLY list **additions**; if the plan mentions any DROP/ALTER, stop
and investigate before accepting.

> `prisma db push` is the convention this repo has used since Phase 1 (there
> is no migrations directory). `--accept-data-loss` is accepted because the
> plan is additive; the plan review above is the guard.

## 4. Merge the PR → Vercel auto-deploys

Merge `v2/phase-11` into `main` on GitHub. Vercel detects the push and
deploys the API (`dr-booking-api.vercel.app`) automatically — no Vercel
console action needed. Verify after deploy:

```bash
curl -s https://dr-booking-api.vercel.app/api/doctors | head -c 400
# → JSON with "registrationNumber":null / "avatarUrl":null fields present
```

## 5. EAS Android build (the new APK)

From `mobile/`, logged in with the owner Expo account (or with a robot token):

```bash
cd mobile
EXPO_TOKEN=<your-expo-token> npx eas-cli build \
  --platform android --profile preview --non-interactive --no-wait
```

The `preview` profile pins `EXPO_PUBLIC_API_URL=https://dr-booking-api.vercel.app`
and produces an internal-distribution APK. Install the fresh APK on devices
(the old installed build keeps working against the additive API, see below).

---

## Backward-compatibility notes

- **API is strictly additive.** Every existing route keeps its old shape; the
  new fields (`registrationNumber`, `avatarUrl`, `pending` list/counts,
  `counts.pending`) are additive, and `PENDING` only appears in payloads
  after new bookings are made. Old API clients never break.
- **Old installed app + new API** (transition window): an old app encountering
  a `PENDING` appointment renders the raw status text via the StatusChip
  runtime fallback (`statusLabel` default branch) instead of the friendly
  "Pending" label — cosmetic only, nothing crashes. Old apps also keep
  receiving `BOOKING_CONFIRMED` pushes as before. Acceptable because app and
  API ship together here; a follow-up release replaces the installed base.
- **New app + not-yet-migrated DB**: the mobile edit form only appears for
  doctors, and the API would 500 on `PATCH /api/doctors/me` until §3 runs —
  so run §3 BEFORE merging §4 (the order above already guarantees this).
- **No data backfill**: existing doctors have NULL registration numbers and
  avatars — the mobile UI renders nothing for NULL (never "N/A" clutter).
  Doctors fill them in via Profile → Edit profile.

## Rollback

- API: revert the merge commit on `main`; Vercel redeploys the previous build.
  The two nullable columns can stay (they are ignored by the old code) — no
  destructive rollback is ever required for this change.
- Mobile: distribute the previous APK (EAS keeps every build); the new app
  against the old API simply shows no pending section until §3/§4 land.
