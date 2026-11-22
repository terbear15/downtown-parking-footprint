"""Turn human-confirmed model detections into regular polygons for the map.

Input : docs/review/review.json (round-1 detections, 224x224 RLE masks on zoom-17 tiles)
        raw/review_round1_results.json (answers: yes / no / unsure)
        later rounds: docs/review/review_r<N>.json + raw/review_round<N>_results.json (lon/lat polygons)
Output: raw/ai_confirmed.json  [{id, city, round, acres, poly:[[lon,lat],...]}]

Shape rule (same as the round-2 model): small gaps are closed, then the lot becomes the
minimum-area rotated rectangle when that rectangle is at least 72% filled, otherwise the
simplified convex outline. Pieces of the same lot that were split across tile edges are merged.
"""
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
Z, N = 17, 224


def rle_decode(rle, n):
    m = np.zeros(n * n, dtype=np.uint8)
    p, v = 0, 0
    for r in rle:
        if v:
            m[p:p + r] = 1
        p += r
        v = 1 - v
    return m.reshape(n, n)


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def close(m, r):
    return 1 - dilate(1 - dilate(m, r), r)


def hull(pts):
    pts = sorted(set(map(tuple, pts)))
    if len(pts) < 3:
        return pts
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2


def min_rect(h):
    best = None
    for i in range(len(h)):
        (x1, y1), (x2, y2) = h[i], h[(i + 1) % len(h)]
        L = math.hypot(x2 - x1, y2 - y1)
        if not L:
            continue
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        a = [x * ux + y * uy for x, y in h]
        b = [-x * uy + y * ux for x, y in h]
        ar = (max(a) - min(a)) * (max(b) - min(b))
        if best is None or ar < best[0]:
            corners = [(min(a), min(b)), (max(a), min(b)), (max(a), max(b)), (min(a), max(b))]
            best = (ar, [(s * ux - t * uy, s * uy + t * ux) for s, t in corners])
    return best


def regularise(mask):
    ys, xs = np.nonzero(mask)
    pts = [(x + 0.5, y + 0.5) for x, y in zip(xs, ys)]
    h = hull(pts)
    if len(h) < 3:
        return None
    ar, rect = min_rect(h)
    return rect if mask.sum() / ar >= 0.72 else h


def to_lonlat(px, py, tx, ty):
    x, y = tx + px / N, ty + py / N
    lon = x / 2 ** Z * 360 - 180
    n = math.pi - 2 * math.pi * y / 2 ** Z
    return [round(lon, 6), round(math.degrees(math.atan(math.sinh(n))), 6)]


def main():
    out = []
    s1 = json.loads((ROOT / "docs/review/review.json").read_text())
    a1 = json.loads((ROOT / "raw/review_round1_results.json").read_text())["answers"]
    # merge "yes" masks per city on a shared tile grid so pieces across tile edges join
    by_city = {}
    for d in s1["detections"]:
        if a1.get(d["id"]) == "yes":
            by_city.setdefault(d["city"], []).append(d)
    for city, dets in by_city.items():
        x0 = min(d["x"] for d in dets) - 1
        y0 = min(d["y"] for d in dets) - 1
        W = (max(d["x"] for d in dets) - x0 + 2) * N
        H = (max(d["y"] for d in dets) - y0 + 2) * N
        grid = np.zeros((H, W), dtype=np.uint8)
        for d in dets:
            m = close(rle_decode(d["mask"], N), 2)
            oy, ox = (d["y"] - y0) * N, (d["x"] - x0) * N
            grid[oy:oy + N, ox:ox + N] |= m
        grid = close(grid, 2)
        # connected components (4-neighbour) with a simple flood fill
        lab = np.zeros_like(grid, dtype=np.int32)
        k = 0
        for sy, sx in zip(*np.nonzero(grid)):
            if lab[sy, sx]:
                continue
            k += 1
            stack = [(sy, sx)]
            lab[sy, sx] = k
            while stack:
                y, x = stack.pop()
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < H and 0 <= xx < W and grid[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = k
                        stack.append((yy, xx))
        lat = sum(d["lat"] for d in dets) / len(dets)
        pxm = 40075016.686 * math.cos(math.radians(lat)) / 2 ** Z / N
        for j in range(1, k + 1):
            m = (lab == j).astype(np.uint8)
            if m.sum() * pxm * pxm < 600:
                continue
            poly = regularise(m)
            if not poly:
                continue
            out.append({"id": f"{city}-r1-{j}", "city": city, "round": 1,
                        "acres": round(area(poly) * pxm * pxm / 4046.856, 3),
                        "poly": [to_lonlat(px, py, x0, y0) for px, py in poly]})
    # later rounds already carry regular lon/lat polygons
    for rnd in range(2, 10):
        sp, rp = ROOT / f"docs/review/review_r{rnd}.json", ROOT / f"raw/review_round{rnd}_results.json"
        if not (sp.exists() and rp.exists()):
            continue
        ans = json.loads(rp.read_text())["answers"]
        for d in json.loads(sp.read_text())["detections"]:
            if ans.get(d["id"]) == "yes":
                out.append({"id": d["id"], "city": d["city"], "round": rnd, "acres": d["acres"], "poly": d["poly"]})
    (ROOT / "raw/ai_confirmed.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(out), "confirmed lots", round(sum(o["acres"] for o in out), 1), "acres")


if __name__ == "__main__":
    main()
