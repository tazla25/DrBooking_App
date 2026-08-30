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
