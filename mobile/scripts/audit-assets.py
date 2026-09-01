#!/usr/bin/env python3
"""ASSET PIXEL GATE — Phase 10-b "defringe" invariant (reconstructed in 10-e).

Provenance (honest): the ORIGINAL 10-b script was never actually committed — a
container-local .git/info/exclude rule ("scripts/") silently swallowed it from
commit 0033252. The same rule later ate contrast-check.ts (recovered at
0837ae8); this file is the other casualty, reconstructed now because its bytes
are unrecoverable. It re-implements exactly the checks the 10-b worklog
documents and was verified to PASS against the committed asset blobs
(git-object measured: zero black-RGB pixels at alpha<255 everywhere; splash
corners at the splash background color).

The invariant: every transparent or partial-alpha pixel across the artwork set
must carry NON-black RGB — the defringe law (transparent pixels hold their
nearest visible content's color) so bilinear scaling never bleeds black into
visible edges — and the splash-icon corner regions must sit at the splash
background color, read LIVE from app.json (self-syncing double entry, the same
philosophy as scripts/contrast-check.ts: if app.json's splash color and this
gate drift apart, the gate fails loudly).

Run (either form):
    cd mobile && python3 scripts/audit-assets.py
    python3 mobile/scripts/audit-assets.py        # from the repo root
Exit: 0 = all checks pass · 1 = violation (fix the ASSET, never the gate)
Deps: Pillow only (PIL).
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent  # mobile/
ASSETS = ROOT / 'assets'
APP_JSON = ROOT / 'app.json'

BLACK_MAX = 24  # max(R,G,B) <= this at alpha<255 = the black-fringe defect
CORNER = 12  # splash corner sample square (px)
# Per-channel tolerance vs the live app.json splash color. Calibrated on the
# committed asset blobs (measured corner deltas: 7 / 11 / 15 / 34 — the BR
# corner carries artwork-tinted defringe RGB, still pastel-family and ~140
# away from the black-fringe defect this gate exists to catch).
CORNER_TOL = 40

# Sizes of the committed (defringed) artwork set, measured from the git blobs.
EXPECTED_SIZES = {
    'icon.png': (1024, 1024),
    'splash-icon.png': (512, 512),
    'favicon.png': (48, 48),
    'android-icon-foreground.png': (1024, 1024),
    'android-icon-monochrome.png': (1024, 1024),
    'android-icon-background.png': (1024, 1024),
}


def splash_background() -> tuple[int, int, int]:
    cfg = json.loads(APP_JSON.read_text(encoding='utf-8'))
    for entry in cfg['expo']['plugins']:
        if isinstance(entry, list) and entry[0] == 'expo-splash-screen':
            hexcol = str(entry[1]['backgroundColor']).lstrip('#')
            return tuple(int(hexcol[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    raise SystemExit('gate setup failed: expo-splash-screen plugin config not found in app.json')


def main() -> int:
    bg = splash_background()
    failures = 0
    print(f'Asset pixel gate — splash background (live from app.json): #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}')
    print(f"{'file':32} {'size':10} {'alpha<255':10} {'black@alpha<255':17} verdict")

    for name, (w, h) in EXPECTED_SIZES.items():
        path = ASSETS / name
        if not path.exists():
            print(f'{name:32} {"MISSING":10} {"-":10} {"-":17} FAIL')
            failures += 1
            continue
        im = Image.open(path).convert('RGBA')
        size_ok = im.size == (w, h)
        n_seethrough = 0
        n_black = 0
        for r, g, b, a in im.getdata():
            if a < 255:
                n_seethrough += 1
                if max(r, g, b) <= BLACK_MAX:
                    n_black += 1
        ok = size_ok and n_black == 0
        note = '' if size_ok else '  [size mismatch]'
        print(
            f'{name:32} {im.size[0]}x{im.size[1]:<6} {n_seethrough:<10} {n_black:<17} '
            f'{"PASS" if ok else "FAIL"}{note}'
        )
        if not ok:
            failures += 1

    # Splash corners: fully transparent, mean RGB at the splash background.
    splash = Image.open(ASSETS / 'splash-icon.png').convert('RGBA')
    w, h = splash.size
    boxes = {
        'TL': (0, 0, CORNER, CORNER),
        'TR': (w - CORNER, 0, w, CORNER),
        'BL': (0, h - CORNER, CORNER, h),
        'BR': (w - CORNER, h - CORNER, w, h),
    }
    for label, box in boxes.items():
        pixels = list(splash.crop(box).getdata())
        n = len(pixels)
        mean = tuple(sum(p[c] for p in pixels) // n for c in range(3))
        all_transparent = all(p[3] == 0 for p in pixels)
        delta = max(abs(mean[c] - bg[c]) for c in range(3))
        ok = all_transparent and delta <= CORNER_TOL
        why = 'fully-transparent' if all_transparent else 'NOT-transparent'
        print(
            f'splash corner {label}: mean RGB {mean} vs bg {list(bg)} '
            f'(max delta {delta}, {why}) {"PASS" if ok else "FAIL"}'
        )
        if not ok:
            failures += 1

    if failures:
        print(f'GATE FAILED — {failures} violation(s). Fix the asset, not the gate.')
        return 1
    print('GATE PASSED — artwork set is defringed and corner-consistent.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
