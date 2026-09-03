# Contrast audit — Glass Reality (Phase 10, A3)

Model: `surface = canvas_stop × (1 − a) + white × a` for the canvas stops `#4A9FE8 → #5E7BE0 → #7C63D8` (read live from `src/theme/tokens.ts` — drift between the token stops and this script's double-entry ledger fails the run) and the spec card-alpha bounds `0.62 / 0.66 / 0.72 / 0.78`. Corner glow blobs are excluded by design: they only brighten the surface behind dark text, so excluding them keeps every measured ratio conservative.

## Gate — text tokens × glass card envelope (must be ≥ 4.5:1)

| Text token | Canvas stop | Card α | Ratio | Verdict |
| --- | --- | --- | ---: | --- |
| text.primary | top (#4A9FE8) | 0.62 | 10.30 | PASS |
| text.primary | top (#4A9FE8) | 0.66 | 10.66 | PASS |
| text.primary | top (#4A9FE8) | 0.72 | 11.35 | PASS |
| text.primary | top (#4A9FE8) | 0.78 | 12.06 | PASS |
| text.primary | mid (#5E7BE0) | 0.62 | 9.43 | PASS |
| text.primary | mid (#5E7BE0) | 0.66 | 9.90 | PASS |
| text.primary | mid (#5E7BE0) | 0.72 | 10.69 | PASS |
| text.primary | mid (#5E7BE0) | 0.78 | 11.52 | PASS |
| text.primary | bottom (#7C63D8) | 0.62 | 9.03 | PASS |
| text.primary | bottom (#7C63D8) | 0.66 | 9.54 | PASS |
| text.primary | bottom (#7C63D8) | 0.72 | 10.34 | PASS |
| text.primary | bottom (#7C63D8) | 0.78 | 11.26 | PASS |
| text.secondary | top (#4A9FE8) | 0.62 | 5.39 | PASS |
| text.secondary | top (#4A9FE8) | 0.66 | 5.58 | PASS |
| text.secondary | top (#4A9FE8) | 0.72 | 5.94 | PASS |
| text.secondary | top (#4A9FE8) | 0.78 | 6.31 | PASS |
| text.secondary | mid (#5E7BE0) | 0.62 | 4.93 | PASS |
| text.secondary | mid (#5E7BE0) | 0.66 | 5.18 | PASS |
| text.secondary | mid (#5E7BE0) | 0.72 | 5.59 | PASS |
| text.secondary | mid (#5E7BE0) | 0.78 | 6.03 | PASS |
| text.secondary | bottom (#7C63D8) | 0.62 | 4.72 | PASS |
| text.secondary | bottom (#7C63D8) | 0.66 | 4.99 | PASS |
| text.secondary | bottom (#7C63D8) | 0.72 | 5.41 | PASS |
| text.secondary | bottom (#7C63D8) | 0.78 | 5.89 | PASS |

**GATE PASSED** — all 24 pairs ≥ 4.5:1.

## Appendix — real pairs outside the gate envelope (informational)

These pairs render in the app but sit outside the spec's card-alpha envelope (nested panels, fields, solid accent surfaces, status tints). They are REPORTED, not gated: fixing them means touching tokens this phase explicitly freezes. Recommendations are listed below.

| Text | Surface (worst stop) | Ratio | Note |
| --- | --- | ---: | --- |
| text.primary | nested .34 (bottom) | 5.88 | ok |
| text.primary | cardSoft .52 (bottom) | 7.77 | ok |
| text.primary | field .58 (bottom) | 8.48 | ok |
| text.primary | header .55 (bottom) | 8.15 | ok |
| text.primary | chip .46 (bottom) | 7.12 | ok |
| text.secondary | nested .34 (bottom) | 3.08 | below 4.5:1 — see recommendations |
| text.secondary | cardSoft .52 (bottom) | 4.07 | below 4.5:1 — see recommendations |
| text.secondary | field .58 (bottom) | 4.44 | below 4.5:1 — see recommendations |
| text.secondary | header .55 (bottom) | 4.26 | below 4.5:1 — see recommendations |
| text.secondary | chip .46 (bottom) | 3.72 | below 4.5:1 — see recommendations |
| white | cta.start (solid) (-) | 1.98 | below 4.5:1 — see recommendations |
| white | cta.end (solid) (-) | 2.87 | below 4.5:1 — see recommendations |
| white | navy (solid) (-) | 16.00 | ok |
| status.CONFIRMED.fg | status tint on card .66 (bottom) | 2.88 | below 4.5:1 — see recommendations |
| status.CALLED.fg | status tint on card .66 (bottom) | 2.94 | below 4.5:1 — see recommendations |
| status.COMPLETED.fg | status tint on card .66 (bottom) | 2.69 | below 4.5:1 — see recommendations |
| status.CANCELLED.fg | status tint on card .66 (bottom) | 2.80 | below 4.5:1 — see recommendations |
| status.NO_SHOW.fg | status tint on card .66 (bottom) | 3.05 | below 4.5:1 — see recommendations |
| status.PENDING.fg | status tint on card .66 (bottom) | 2.33 | below 4.5:1 — see recommendations |

### Recommendations (follow-up, outside this phase's frozen scope)

- `text.secondary` on nested `.34` panels (staff count cards): falls in the low-3s. Prefer `text.primary` for micro labels on nested panels, or raise `nested` in a future phase and re-run this gate.
- `text.secondary` placeholders over `field .58`: ~4.2 at the darkest stop. Acceptable for placeholder semantics; if the owner wants it gated, darken `text.secondary` one step and re-run.
- White on the solid CTA accent (~2.9): pre-existing brand choice for 11–16px semibold labels on `ctaGradient`. A future phase could deepen the accent end-stop or switch labels to navy; out of scope here (B6 rejected adjacent label changes).
- Status tints over card: inherited from the Phase 8 frozen palette; re-check if the band changes again.


## Aurora gate (Phase 12 — light pastel canvas + white acrylic + M3)

Model: aurora text tokens composited over the light canvas stops `#BFD9F2 → #C7E3EC → #CBC6E8` (parsed live from `src/theme/aurora.ts`) × the glass tier alphas `0.70 / 0.80 / 0.90`, plus the gradient CTA stops, chip pairs, solid buttons, the status tints and the mobilefix3 carousel card stacks (chip tint over tile over stop). Regression law: the gated worst must stay ≥ 4.72:1 (the Phase-10 worst — no regression below it).

| Text token | Surface (worst) | Ratio | Verdict |
| --- | --- | ---: | --- |
| onSurface | aurora top a=0.70 | 15.44 | PASS |
| onSurface | aurora top a=0.80 | 15.92 | PASS |
| onSurface | aurora top a=0.90 | 16.55 | PASS |
| onSurface | aurora mid a=0.70 | 15.78 | PASS |
| onSurface | aurora mid a=0.80 | 16.17 | PASS |
| onSurface | aurora mid a=0.90 | 16.64 | PASS |
| onSurface | aurora bottom a=0.70 | 14.92 | PASS |
| onSurface | aurora bottom a=0.80 | 15.69 | PASS |
| onSurface | aurora bottom a=0.90 | 16.37 | PASS |
| onSurfaceVariant | aurora top a=0.70 | 8.43 | PASS |
| onSurfaceVariant | aurora top a=0.80 | 8.69 | PASS |
| onSurfaceVariant | aurora top a=0.90 | 9.03 | PASS |
| onSurfaceVariant | aurora mid a=0.70 | 8.61 | PASS |
| onSurfaceVariant | aurora mid a=0.80 | 8.82 | PASS |
| onSurfaceVariant | aurora mid a=0.90 | 9.08 | PASS |
| onSurfaceVariant | aurora bottom a=0.70 | 8.14 | PASS |
| onSurfaceVariant | aurora bottom a=0.80 | 8.56 | PASS |
| onSurfaceVariant | aurora bottom a=0.90 | 8.93 | PASS |
| primary | aurora top a=0.70 | 8.23 | PASS |
| primary | aurora top a=0.80 | 8.48 | PASS |
| primary | aurora top a=0.90 | 8.82 | PASS |
| primary | aurora mid a=0.70 | 8.40 | PASS |
| primary | aurora mid a=0.80 | 8.61 | PASS |
| primary | aurora mid a=0.90 | 8.87 | PASS |
| primary | aurora bottom a=0.70 | 7.95 | PASS |
| primary | aurora bottom a=0.80 | 8.36 | PASS |
| primary | aurora bottom a=0.90 | 8.72 | PASS |
| secondary | aurora top a=0.70 | 5.80 | PASS |
| secondary | aurora top a=0.80 | 5.98 | PASS |
| secondary | aurora top a=0.90 | 6.21 | PASS |
| secondary | aurora mid a=0.70 | 5.92 | PASS |
| secondary | aurora mid a=0.80 | 6.07 | PASS |
| secondary | aurora mid a=0.90 | 6.25 | PASS |
| secondary | aurora bottom a=0.70 | 5.60 | PASS |
| secondary | aurora bottom a=0.80 | 5.89 | PASS |
| secondary | aurora bottom a=0.90 | 6.14 | PASS |
| tertiary | aurora top a=0.70 | 8.24 | PASS |
| tertiary | aurora top a=0.80 | 8.49 | PASS |
| tertiary | aurora top a=0.90 | 8.83 | PASS |
| tertiary | aurora mid a=0.70 | 8.42 | PASS |
| tertiary | aurora mid a=0.80 | 8.63 | PASS |
| tertiary | aurora mid a=0.90 | 8.88 | PASS |
| tertiary | aurora bottom a=0.70 | 7.96 | PASS |
| tertiary | aurora bottom a=0.80 | 8.37 | PASS |
| tertiary | aurora bottom a=0.90 | 8.73 | PASS |
| error | aurora top a=0.70 | 5.81 | PASS |
| error | aurora top a=0.80 | 5.99 | PASS |
| error | aurora top a=0.90 | 6.23 | PASS |
| error | aurora mid a=0.70 | 5.94 | PASS |
| error | aurora mid a=0.80 | 6.09 | PASS |
| error | aurora mid a=0.90 | 6.27 | PASS |
| error | aurora bottom a=0.70 | 5.62 | PASS |
| error | aurora bottom a=0.80 | 5.91 | PASS |
| error | aurora bottom a=0.90 | 6.16 | PASS |
| onErrorContainer | aurora top a=0.70 | 8.42 | PASS |
| onErrorContainer | aurora top a=0.80 | 8.68 | PASS |
| onErrorContainer | aurora top a=0.90 | 9.02 | PASS |
| onErrorContainer | aurora mid a=0.70 | 8.60 | PASS |
| onErrorContainer | aurora mid a=0.80 | 8.82 | PASS |
| onErrorContainer | aurora mid a=0.90 | 9.07 | PASS |
| onErrorContainer | aurora bottom a=0.70 | 8.13 | PASS |
| onErrorContainer | aurora bottom a=0.80 | 8.55 | PASS |
| onErrorContainer | aurora bottom a=0.90 | 8.92 | PASS |
| onSecondaryContainer | aurora top a=0.70 | 6.40 | PASS |
| onSecondaryContainer | aurora top a=0.80 | 6.60 | PASS |
| onSecondaryContainer | aurora top a=0.90 | 6.86 | PASS |
| onSecondaryContainer | aurora mid a=0.70 | 6.54 | PASS |
| onSecondaryContainer | aurora mid a=0.80 | 6.70 | PASS |
| onSecondaryContainer | aurora mid a=0.90 | 6.90 | PASS |
| onSecondaryContainer | aurora bottom a=0.70 | 6.18 | PASS |
| onSecondaryContainer | aurora bottom a=0.80 | 6.50 | PASS |
| onSecondaryContainer | aurora bottom a=0.90 | 6.78 | PASS |
| onTertiaryFixedVariant | aurora top a=0.70 | 8.36 | PASS |
| onTertiaryFixedVariant | aurora top a=0.80 | 8.62 | PASS |
| onTertiaryFixedVariant | aurora top a=0.90 | 8.96 | PASS |
| onTertiaryFixedVariant | aurora mid a=0.70 | 8.54 | PASS |
| onTertiaryFixedVariant | aurora mid a=0.80 | 8.76 | PASS |
| onTertiaryFixedVariant | aurora mid a=0.90 | 9.01 | PASS |
| onTertiaryFixedVariant | aurora bottom a=0.70 | 8.08 | PASS |
| onTertiaryFixedVariant | aurora bottom a=0.80 | 8.50 | PASS |
| onTertiaryFixedVariant | aurora bottom a=0.90 | 8.86 | PASS |
| onPrimary | gradient primary-container | 6.29 | PASS |
| onPrimary | onDark chip on primary-container | 5.12 | PASS |
| onPrimary | gradient primary | 9.14 | PASS |
| onPrimary | onDark chip on primary | 7.40 | PASS |
| onPrimary | gradient secondary | 6.44 | PASS |
| onPrimary | onDark chip on secondary | 5.21 | PASS |
| primary | white CTA | 9.14 | PASS |
| onPrimary | tertiary button | 9.15 | PASS |
| onErrorContainer | errorContainer | 7.24 | PASS |
| onPrimary | selected chip | 6.29 | PASS |
| onSurfaceVariant | quiet chip | 8.49 | PASS |
| auroraStatus.PENDING | status PENDING on bottom | 7.24 | PASS |
| auroraStatus.CONFIRMED | status CONFIRMED on bottom | 5.55 | PASS |
| auroraStatus.CALLED | status CALLED on bottom | 6.72 | PASS |
| auroraStatus.COMPLETED | status COMPLETED on bottom | 7.52 | PASS |
| auroraStatus.CANCELLED | status CANCELLED on top | 7.24 | PASS |
| auroraStatus.NO_SHOW | status NO_SHOW on top | 7.26 | PASS |
| carousel.tokenNum | carousel tile on top + chip tint | 8.47 | PASS |
| carousel.tokenNum | carousel tile on mid + chip tint | 8.52 | PASS |
| carousel.tokenNum | carousel tile on bottom + chip tint | 8.41 | PASS |
| carousel.metaText | carousel tile on top | 8.43 | PASS |
| carousel.metaText | carousel tile on mid | 8.61 | PASS |
| carousel.metaText | carousel tile on bottom | 8.14 | PASS |
| carousel.pendingChip | carousel tile on top + chip tint | 7.14 | PASS |
| carousel.pendingChip | carousel tile on mid + chip tint | 7.25 | PASS |
| carousel.pendingChip | carousel tile on bottom + chip tint | 6.88 | PASS |
| carousel.forDateChip | carousel tile on top + chip tint | 7.14 | PASS |
| carousel.forDateChip | carousel tile on mid + chip tint | 7.25 | PASS |
| carousel.forDateChip | carousel tile on bottom + chip tint | 6.88 | PASS |

**AURORA GATE PASSED** — all 110 pairs ≥ 4.5:1; worst 5.12:1 (onPrimary @ onDark chip on primary-container, floor 4.72:1).

---
Generated by `scripts/contrast-check.ts` — run `bun scripts/contrast-check.ts` from `mobile/` after any token change. Failing the gate fails the delivery.
