# Dr_Booking — mobile app (placeholder)

Native app for patients, doctors and compounders. **Placeholder for Phase 4** —
no code lives here yet, by design (Phase 1 delivers the API foundation only).

## Planned stack (locked)

- Expo SDK 52+, Expo Router (file-based navigation)
- React Native + TypeScript (strict)
- Consumes the REST API in `../api` exclusively — no direct DB access, no
  secrets in client code; auth via the opaque bearer token from
  `POST /api/auth/login`

## Planned structure (when implementation starts)

```
mobile/
├── app/            # Expo Router routes (patient/doctor/compounder tabs)
├── src/api/        # typed API client (zod-validated responses)
├── src/components/ # shared RN components
├── src/lib/        # time/format helpers mirroring api/src/lib/time.ts (IST)
└── ...
```

Until then: see the repository root `README.md` for architecture and the API
conventions, and `../api/src/app/api/` for the endpoint catalogue.
