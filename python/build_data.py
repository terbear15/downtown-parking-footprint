"""Downtown Parking Footprint - data build.

Inputs (raw/, produced in the browser from public sources):
  dpf_boundaries.json  downtown cells per city (LODES 2023 job density rule)
  dpf_cores.json       densest job cell per city (the "downtown core")
  dpf_osm_<city>.json  OSM parking lots, building area per cell, transit stops

Outputs (docs/data/):
  index.json           city list + RQ1 summary, sorted by name
  cities/<id>.json     outline, lots with RQ1/RQ2 attributes, stats
  manifest.json        counts, totals and SHA-256 of every output file

RQ1 measures surface parking area inside each downtown boundary.
RQ2 screens lots against four criteria that can be checked with open data;
the fifth (zoning) is reported as "not verified". Scores are screening
results, not recommendations.

Data: (c) OpenStreetMap contributors, ODbL. U.S. Census Bureau LEHD LODES 8.
"""
import hashlib
import json
import math
import statistics
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "docs" / "data"

M2_PER_ACRE = 4046.8564224
SQFT_PER_M2 = 10.7639104
MILE = 1609.344

# RQ2 thresholds (from the project brief)
MIN_ACRES = 1.5
CORE_MAX_M = 0.5 * MILE
TRANSIT_MAX_M = 0.25 * MILE
DENSITY_RADIUS_M = 0.25 * MILE

# Lots that are not surface parking
NOT_SURFACE = {"underground", "multi-storey", "rooftop", "garage", "garages",
               "sheds", "carports", "street_side", "lane", "on_kerb", "half_on_kerb",
               "layby"}

NAMES = {
    "baltimore": ("Baltimore", "MD"), "boston": ("Boston", "MA"), "charlotte": ("Charlotte", "NC"),
    "chicago": ("Chicago", "IL"), "cleveland": ("Cleveland", "OH"), "dallas": ("Dallas", "TX"),
    "denver": ("Denver", "CO"), "detroit": ("Detroit", "MI"), "houston": ("Houston", "TX"),
    "kansascity": ("Kansas City", "MO"), "losangeles": ("Los Angeles", "CA"), "memphis": ("Memphis", "TN"),
    "miami": ("Miami", "FL"), "neworleans": ("New Orleans", "LA"), "newyork": ("New York (Manhattan)", "NY"),
    "orlando": ("Orlando", "FL"), "philadelphia": ("Philadelphia", "PA"), "phoenix": ("Phoenix", "AZ"),
    "pittsburgh": ("Pittsburgh", "PA"), "portland": ("Portland", "OR"), "sacramento": ("Sacramento", "CA"),
    "sanfrancisco": ("San Francisco", "CA"), "seattle": ("Seattle", "WA"), "stlouis": ("St. Louis", "MO"),
}


class Proj:
    def __init__(self, b):
        self.lat0, self.lon0, self.kx, self.ky, self.c = b["lat0"], b["lon0"], b["kx"], b["ky"], b["cell"]

    def xy(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def ll(self, x, y):
        return (self.lon0 + x / self.kx, self.lat0 + y / self.ky)


def decode(s):
    v = list(map(int, s.split()))
    x, y = v[0], v[1]
    pts = [(x / 1e5, y / 1e5)]
    for i in range(2, len(v), 2):
        x += v[i]
        y += v[i + 1]
        pts.append((x / 1e5, y / 1e5))
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts  # (lon, lat)


def encode(pts):
    q = [(round(lon * 1e5), round(lat * 1e5)) for lon, lat in pts]
    out = [q[0][0], q[0][1]]
    for i in range(1, len(q)):
        out += [q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]
    return " ".join(map(str, out))


def area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2  # signed


def clip(ring, x0, y0, x1, y1):
    """Sutherland-Hodgman clip of a polygon to an axis-aligned box."""
    def run(pts, inside, cut):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(cut(a, b))
                out.append(b)
            elif ia:
                out.append(cut(a, b))
        return out

    def cx(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + t * (b[1] - a[1]))

    def cy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return (a[0] + t * (b[0] - a[0]), y)

    p = ring
    for inside, cut in (
        (lambda q: q[0] >= x0, lambda a, b: cx(a, b, x0)),
        (lambda q: q[0] <= x1, lambda a, b: cx(a, b, x1)),
        (lambda q: q[1] >= y0, lambda a, b: cy(a, b, y0)),
        (lambda q: q[1] <= y1, lambda a, b: cy(a, b, y1)),
    ):
        if not p:
            break
        p = run(p, inside, cut)
    return p


def area_in_cells(ring, cells, c):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    total = 0.0
    for i in range(math.floor(min(xs) / c), math.floor(max(xs) / c) + 1):
        for j in range(math.floor(min(ys) / c), math.floor(max(ys) / c) + 1):
            if (i, j) in cells:
                q = clip(ring, i * c, j * c, (i + 1) * c, (j + 1) * c)
                if len(q) >= 3:
                    total += abs(area(q))
    return total


def outline(cells, proj):
    """Boundary rings of a union of grid cells, in lon/lat."""
    c = proj.c
    edges = {}
    for (i, j) in cells:
        for a, b, n in (((i, j), (i + 1, j), (i, j - 1)), ((i + 1, j), (i + 1, j + 1), (i + 1, j)),
                        ((i + 1, j + 1), (i, j + 1), (i, j + 1)), ((i, j + 1), (i, j), (i - 1, j))):
            if n not in cells:
                edges.setdefault(a, []).append(b)
    rings = []
    while edges:
        start = next(iter(edges))
        ring = [start]
        cur = start
        while True:
            nxt = edges[cur].pop()
            if not edges[cur]:
                del edges[cur]
            if nxt == start:
                break
            ring.append(nxt)
            cur = nxt
        # drop collinear points
        simple = [p for k, p in enumerate(ring)
                  if not ((ring[k - 1][0] == p[0] == ring[(k + 1) % len(ring)][0]) or
                          (ring[k - 1][1] == p[1] == ring[(k + 1) % len(ring)][1]))]
        rings.append(encode([proj.ll(x * c, y * c) for x, y in simple]))
    return rings


def build_city(cid, b, core, osm):
    proj = Proj(b)
    c = proj.c
    cells = {tuple(x) for x in b["cells"]}
    cell_m2 = c * c
    dt_m2 = len(cells) * cell_m2

    if "latlon" in core:
        cxm, cym = proj.xy(core["latlon"][1], core["latlon"][0])
    else:
        cxm, cym = (core["cell"][0] + 0.5) * c, (core["cell"][1] + 0.5) * c

    # building coverage within DENSITY_RADIUS_M of a point, from per-cell building area
    bldg = {tuple(map(int, k.split(","))): v for k, v in osm["bldg"].items()}
    r_cells = math.ceil(DENSITY_RADIUS_M / c)

    def coverage(x, y, own=0.0):
        # share of the surrounding land (excluding the lot itself) covered by buildings
        ci, cj = math.floor(x / c), math.floor(y / c)
        a = n = 0
        for i in range(ci - r_cells, ci + r_cells + 1):
            for j in range(cj - r_cells, cj + r_cells + 1):
                if math.hypot((i + 0.5) * c - x, (j + 0.5) * c - y) <= DENSITY_RADIUS_M:
                    a += bldg.get((i, j), 0)
                    n += 1
        return a / max(n * cell_m2 - own, cell_m2)

    median_cov = statistics.median(coverage((i + 0.5) * c, (j + 0.5) * c) for i, j in cells)

    stops = [(proj.xy(s[1] / 1e5, s[0] / 1e5), s[2]) for s in osm["stops"]]

    lots = []
    for L in osm["lots"]:
        t = L["tags"]
        if (t.get("parking") or "surface") in NOT_SURFACE:
            continue
        outer = [[proj.xy(*p) for p in decode(r)] for r in L["outer"]]
        inner = [[proj.xy(*p) for p in decode(r)] for r in L.get("inner", [])]
        outer = [r for r in outer if len(r) >= 3]
        if not outer:
            continue
        full = sum(abs(area(r)) for r in outer) - sum(abs(area(r)) for r in inner if len(r) >= 3)
        inside = sum(area_in_cells(r, cells, c) for r in outer) - sum(area_in_cells(r, cells, c) for r in inner if len(r) >= 3)
        if inside <= 1:
            continue
        ring = max(outer, key=lambda r: abs(area(r)))
        a = area(ring)
        gx = sum((ring[k][0] + ring[(k + 1) % len(ring)][0]) * (ring[k][0] * ring[(k + 1) % len(ring)][1] - ring[(k + 1) % len(ring)][0] * ring[k][1]) for k in range(len(ring))) / (6 * a)
        gy = sum((ring[k][1] + ring[(k + 1) % len(ring)][1]) * (ring[k][0] * ring[(k + 1) % len(ring)][1] - ring[(k + 1) % len(ring)][0] * ring[k][1]) for k in range(len(ring))) / (6 * a)
        d_core = math.hypot(gx - cxm, gy - cym)
        d_any = min((math.hypot(gx - sx, gy - sy) for (sx, sy), _ in stops), default=None)
        d_rail = min((math.hypot(gx - sx, gy - sy) for (sx, sy), r in stops if r), default=None)
        cov = coverage(gx, gy, full)
        acres = full / M2_PER_ACRE
        checks = {
            "size": acres >= MIN_ACRES,
            "core": d_core <= CORE_MAX_M,
            "transit": d_any is not None and d_any <= TRANSIT_MAX_M,
            "density": cov > median_cov,
        }
        lon, lat = proj.ll(gx, gy)
        lots.append({
            "id": L["id"],
            "name": t.get("name"), "parking": t.get("parking"), "fee": t.get("fee"),
            "access": t.get("access"), "capacity": t.get("capacity"),
            "acres": round(acres, 3), "acresInside": round(inside / M2_PER_ACRE, 3),
            "center": [round(lon, 5), round(lat, 5)],
            "coreMi": round(d_core / MILE, 2),
            "transitMi": None if d_any is None else round(d_any / MILE, 2),
            "railMi": None if d_rail is None else round(d_rail / MILE, 2),
            "bldgCoverage": round(cov, 3),
            "checks": checks, "zoning": None,
            "score": sum(checks.values()),
            "outer": [encode([proj.ll(*p) for p in r]) for r in outer],
            "inner": [encode([proj.ll(*p) for p in r]) for r in inner if len(r) >= 3],
        })
    lots.sort(key=lambda l: (-l["score"], -l["acres"]))

    total_in = sum(l["acresInside"] for l in lots) * M2_PER_ACRE
    bins = {"lt0_5": [0, 0.0], "0_5to2": [0, 0.0], "gt2": [0, 0.0]}
    for l in lots:
        k = "lt0_5" if l["acres"] < 0.5 else ("0_5to2" if l["acres"] <= 2 else "gt2")
        bins[k][0] += 1
        bins[k][1] += l["acresInside"]
    xs = [p for r in b["cells"] for p in [r]]
    lons_lats = [proj.ll(i * c, j * c) for i, j in cells] + [proj.ll((i + 1) * c, (j + 1) * c) for i, j in cells]
    bounds = [[round(min(p[0] for p in lons_lats), 5), round(min(p[1] for p in lons_lats), 5)],
              [round(max(p[0] for p in lons_lats), 5), round(max(p[1] for p in lons_lats), 5)]]
    name, state = NAMES[cid]
    stats = {
        "downtownAcres": round(dt_m2 / M2_PER_ACRE, 1),
        "downtownSqMi": round(dt_m2 / MILE ** 2, 2),
        "lots": len(lots),
        "parkingAcres": round(total_in / M2_PER_ACRE, 1),
        "parkingSqFt": round(total_in * SQFT_PER_M2),
        "share": round(total_in / dt_m2, 4),
        "bins": {k: {"lots": v[0], "acres": round(v[1], 1)} for k, v in bins.items()},
        "candidates": {s: sum(1 for l in lots if l["score"] == s) for s in range(5)},
        "medianBldgCoverage": round(median_cov, 3),
        "transitStops": len(stops),
        "jobs": b.get("jobs"),
        "lodesYear": b.get("lodesYear"),
    }
    city = {
        "id": cid, "name": name, "state": state,
        "core": [round(v, 5) for v in proj.ll(cxm, cym)],
        "bounds": bounds, "outline": outline(cells, proj),
        "rule": b["rule"], "osmFetched": osm["fetched"][:10],
        "stats": stats, "lots": lots,
    }
    return city


def main():
    bounds = json.loads((RAW / "dpf_boundaries.json").read_text())["cities"]
    cores = json.loads((RAW / "dpf_cores.json").read_text())
    (OUT / "cities").mkdir(parents=True, exist_ok=True)
    index, manifest = [], {"built": date.today().isoformat(), "thresholds": {
        "minAcres": MIN_ACRES, "coreMaxMi": 0.5, "transitMaxMi": 0.25, "densityRadiusMi": 0.25,
        "densityRule": "building coverage above the downtown median"}, "files": {}}
    for cid in sorted(bounds, key=lambda k: NAMES[k][0]):
        f = RAW / f"dpf_osm_{cid}.json"
        if not f.exists():
            print("missing OSM data:", cid)
            continue
        city = build_city(cid, bounds[cid], cores[cid], json.loads(f.read_text()))
        for l in city["lots"]:
            for k in [k for k, v in l.items() if v is None or v == []]:
                del l[k]
        text = json.dumps(city, separators=(",", ":"))
        p = OUT / "cities" / f"{cid}.json"
        p.write_text(text, encoding="utf-8")
        s = city["stats"]
        index.append({"id": cid, "name": city["name"], "state": city["state"], "core": city["core"],
                      "bounds": city["bounds"], "stats": {k: s[k] for k in (
                          "downtownSqMi", "lots", "parkingAcres", "share", "candidates", "lodesYear")}})
        manifest["files"][f"cities/{cid}.json"] = {
            "sha256": hashlib.sha256(text.encode()).hexdigest(), "bytes": len(text),
            "lots": s["lots"], "parkingAcres": s["parkingAcres"], "share": s["share"],
            "downtownCells": len(bounds[cid]["cells"]), "osmFetched": city["osmFetched"]}
        print(f"{cid:14s} lots={s['lots']:5d} parking={s['parkingAcres']:7.1f} ac share={s['share']*100:5.1f}% "
              f"score4={s['candidates'][4]:3d} {len(text)/1024:6.0f} KB")
    text = json.dumps({"built": manifest["built"], "osmFetched": max(v["osmFetched"] for k, v in manifest["files"].items() if k.startswith("cities/")), "cities": index}, separators=(",", ":"))
    (OUT / "index.json").write_text(text, encoding="utf-8")
    manifest["files"]["index.json"] = {"sha256": hashlib.sha256(text.encode()).hexdigest(), "bytes": len(text)}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
