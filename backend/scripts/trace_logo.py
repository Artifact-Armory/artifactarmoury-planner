#!/usr/bin/env python3
"""Trace a logo PNG into the polygon rings the geometry watermark cuts.

    python scripts/trace_logo.py "path/to/Logo-Transprant-file.png" \
        [--out blender/logo_shape.json] [--epsilon 1.2] [--band 0] [--min-area-frac 0.02]

Output is `blender/logo_shape.json`, loaded by bake_proxy.py's `_logo_polygon()`:

    {"rings": [[[x, y], ...], ...], "source": "...", "notes": "..."}

Coordinates are normalised to UNIT HEIGHT, centred on (0,0), y-UP (image y is
flipped), which is exactly the contract `_logo_polygon()` already used for the
built-in shield — so the cutter needs no unit handling of its own.

Why a committed data file rather than tracing at bake time: the trace is
deterministic and the logo changes ~never, so doing it once keeps Pillow/numpy
out of the Blender worker's runtime dependencies and keeps the exact cut shape
reviewable in git.

STENCIL SAFETY is checked, not assumed. A cutout can't have a ring nested
inside another ring: the material between them is bounded entirely by removed
faces and would drop out as a floating island. This script fails loudly if it
finds one, so a future logo revision can't silently start shedding debris into
previews. The Artifact Armoury monogram passes because its chevron counter
opens at the bottom and the compass star is a separate solid component.
"""
import argparse
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image


def ink_mask(path, threshold=128):
    """Binary ink mask. Uses alpha when present (the brand PNG is a white logo
    on transparency — luminance alone would read it as blank), else luminance
    with auto-polarity so a dark-on-light export traces the same way."""
    im = Image.open(path)
    a = np.array(im.convert("RGBA"))
    alpha = a[:, :, 3]
    if alpha.min() < 250:
        return alpha > threshold
    lum = a[:, :, :3].mean(axis=2)
    ink = lum > threshold
    if ink.mean() > 0.5:  # mostly "ink" => it's really dark-on-light
        ink = ~ink
    return ink


def horizontal_bands(mask):
    """Row ranges of ink separated by fully empty rows — the logo's stacked
    lockup (monogram over wordmark) splits cleanly on these."""
    rows = mask.any(axis=1)
    bands = []
    start = None
    for i, has in enumerate(rows):
        if has and start is None:
            start = i
        elif not has and start is not None:
            bands.append((start, i - 1))
            start = None
    if start is not None:
        bands.append((start, len(rows) - 1))
    return bands


def components(mask):
    """4-connected components of True pixels, largest first."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for j in range(h):
        for i in range(w):
            if mask[j, i] and not seen[j, i]:
                q = deque([(j, i)])
                seen[j, i] = True
                pixels = []
                while q:
                    cj, ci = q.popleft()
                    pixels.append((cj, ci))
                    for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nj, ni = cj + dj, ci + di
                        if 0 <= nj < h and 0 <= ni < w and mask[nj, ni] and not seen[nj, ni]:
                            seen[nj, ni] = True
                            q.append((nj, ni))
                comp = np.zeros_like(mask)
                for cj, ci in pixels:
                    comp[cj, ci] = True
                out.append((len(pixels), comp))
    out.sort(key=lambda t: -t[0])
    return out


# Crack-following: walk the boundary BETWEEN ink and background along pixel
# edges, so the traced ring is a real closed outline of the filled region
# rather than a ring of pixel centres (which would cut half a pixel inside the
# shape and round off every sharp point — the monogram is all sharp points).
#
# Directions are (dx, dy) with image y running DOWN: R, D, L, U.
_DIRS = [(1, 0), (0, 1), (-1, 0), (0, -1)]


def _edge_pixels(x, y, d):
    """The two pixels flanking the edge that leaves corner (x, y) in direction
    d, as ((ry, rx), (ly, lx)) — right of travel first. The whole trace holds
    one invariant: ink on the RIGHT, background on the LEFT."""
    if d == 0:                                  # right, along a horizontal crack
        return (y, x), (y - 1, x)               # below, above
    if d == 1:                                  # down, along a vertical crack
        return (y, x - 1), (y, x)               # west, east
    if d == 2:                                  # left
        return (y - 1, x - 1), (y, x - 1)       # above, below
    return (y - 1, x), (y - 1, x - 1)           # up: east, west


def trace_ring(mask, start_y, start_x):
    """Trace the closed crack boundary of the ink region containing the pixel
    (start_y, start_x), which must be the region's topmost-then-leftmost pixel.
    Returns a list of (x, y) corner points in image coordinates."""
    h, w = mask.shape

    def ink(y, x):
        return 0 <= y < h and 0 <= x < w and bool(mask[y, x])

    def valid(x, y, d):
        (ry, rx), (ly, lx) = _edge_pixels(x, y, d)
        return ink(ry, rx) and not ink(ly, lx)

    # Start at that pixel's top-left corner heading right along its top edge:
    # ink below (the pixel itself), background above (it is the topmost row).
    sx, sy, sd = start_x, start_y, 0
    x, y, d = sx, sy, sd
    pts = []
    steps = 0
    limit = 8 * (h * w) + 1000
    while True:
        if steps > limit:
            raise RuntimeError("contour trace failed to close")
        # Prefer the sharpest left turn that still keeps ink on the right:
        # left turns hug concave corners, right turns round convex ones.
        for turn in (-1, 0, 1, 2):
            nd = (d + turn) % 4
            if valid(x, y, nd):
                d = nd
                break
        else:
            raise RuntimeError("contour trace found no outgoing edge")
        # Closed once we are back at the start corner about to LEAVE the way we
        # first left (comparing the arrival direction instead never matches).
        if steps > 0 and (x, y) == (sx, sy) and d == sd:
            break
        pts.append((x, y))
        dx, dy = _DIRS[d]
        x, y = x + dx, y + dy
        steps += 1
    # Drop collinear runs so the staircase becomes real corners.
    out = []
    for p in pts:
        if len(out) >= 2:
            (x0, y0), (x1, y1) = out[-2], out[-1]
            if (x1 - x0) * (p[1] - y1) == (y1 - y0) * (p[0] - x1):
                out[-1] = p
                continue
        out.append(p)
    return out


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker simplification of an open polyline."""
    if len(points) < 3:
        return list(points)
    (x0, y0), (x1, y1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = (dx * dx + dy * dy) ** 0.5
    idx, dmax = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if norm < 1e-9:
            d = ((px - x0) ** 2 + (py - y0) ** 2) ** 0.5
        else:
            d = abs(dy * (px - x0) - dx * (py - y0)) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax <= epsilon:
        return [points[0], points[-1]]
    return rdp(points[:idx + 1], epsilon)[:-1] + rdp(points[idx:], epsilon)


def simplify_ring(ring, epsilon):
    """RDP on a CLOSED ring: rotate to a sharp corner first so the split point
    is a real vertex and never rounds off a spike (the star's points)."""
    n = len(ring)
    if n < 4:
        return ring
    best, best_turn = 0, None
    for i in range(n):
        (ax, ay), (bx, by), (cx, cy) = ring[i - 1], ring[i], ring[(i + 1) % n]
        v1 = (bx - ax, by - ay)
        v2 = (cx - bx, cy - by)
        cross = abs(v1[0] * v2[1] - v1[1] * v2[0])
        if best_turn is None or cross > best_turn:
            best, best_turn = i, cross
    rot = ring[best:] + ring[:best]
    simplified = rdp(rot + [rot[0]], epsilon)
    if simplified and simplified[0] == simplified[-1]:
        simplified = simplified[:-1]
    return simplified


def ring_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", default=None)
    ap.add_argument("--epsilon", type=float, default=3.0,
                    help="RDP tolerance in source pixels (higher = fewer vertices)")
    ap.add_argument("--band", type=int, default=0,
                    help="which horizontal ink band to trace, top-down; "
                         "0 = the monogram in the stacked brand lockup. -1 = all")
    ap.add_argument("--min-area-frac", type=float, default=0.02,
                    help="drop ink components smaller than this fraction of the largest")
    args = ap.parse_args()

    mask = ink_mask(args.image)
    bands = horizontal_bands(mask)
    if not bands:
        print("No ink found in image", file=sys.stderr)
        return 2
    if args.band >= 0:
        if args.band >= len(bands):
            print("Band %d out of range (%d bands)" % (args.band, len(bands)), file=sys.stderr)
            return 2
        y0, y1 = bands[args.band]
        mask = mask[y0:y1 + 1, :]
    cols = np.nonzero(mask.any(axis=0))[0]
    rows = np.nonzero(mask.any(axis=1))[0]
    mask = mask[rows.min():rows.max() + 1, cols.min():cols.max() + 1]

    comps = components(mask)
    biggest = comps[0][0]
    kept = [c for c in comps if c[0] >= biggest * args.min_area_frac]
    print("ink components: %d total, %d kept (>= %.0f%% of largest)"
          % (len(comps), len(kept), args.min_area_frac * 100))

    rings = []
    for count, comp in kept:
        ys, xs = np.nonzero(comp)
        top = ys.min()
        left = xs[ys == top].min()
        ring = trace_ring(comp, top, left)
        before = len(ring)
        ring = simplify_ring(ring, args.epsilon)
        print("  component %7d px: %d corners -> %d vertices" % (count, before, len(ring)))
        rings.append(ring)

    # Stencil safety: a ring inside another ring leaves floating material.
    for i, a in enumerate(rings):
        for j, b in enumerate(rings):
            if i != j and point_in_ring(a[0], b):
                print("REFUSING: ring %d is nested inside ring %d — cutting this "
                      "shape would leave a floating island of material." % (i, j),
                      file=sys.stderr)
                return 1

    h, w = mask.shape
    height = float(h)
    cx, cy = w / 2.0, h / 2.0
    norm = [[[round((x - cx) / height, 5), round(-(y - cy) / height, 5)] for x, y in r]
            for r in rings]
    total_area = sum(abs(ring_area(r)) for r in norm)
    print("normalised: %d rings, %d vertices, ink area %.3f of unit-height box"
          % (len(norm), sum(len(r) for r in norm), total_area))

    out = args.out or os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "blender", "logo_shape.json")
    with open(out, "w") as f:
        json.dump({
            "rings": norm,
            "source": os.path.basename(args.image),
            "notes": ("Traced by scripts/trace_logo.py. Unit height, centred on "
                      "(0,0), y-up. Cut as through-holes by bake_proxy.py "
                      "_emboss_logo_grid."),
            "epsilon": args.epsilon,
            "band": args.band,
        }, f, indent=1)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
