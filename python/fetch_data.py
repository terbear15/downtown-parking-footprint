"""Downtown Parking Footprint - re-download all raw data in one command.

    python3 python/fetch_data.py                 # every city in CITIES
    python3 python/fetch_data.py stlouis denver  # only these cities

Steps per city (the same rules the published data used):
  1. LODES 8 (U.S. Census Bureau): block crosswalk (block centroids) + workplace jobs (WAC, all jobs).
     Jobs go to 250 m cells; a cell's density is its 3x3 mean in jobs/acre; downtown is the
     4-connected cluster >= 25 jobs/acre containing the densest cell within 3 km of city hall,
     with enclosed holes filled. Manhattan (newyork) is all of New York County.
  2. OpenStreetMap API 0.6 /map calls over the downtown plus a 500 m margin, in 750 m tiles
     (split further when the API reports too many nodes): parking areas, building area per
     cell, transit stops.
Outputs go to raw/ (dpf_boundaries_fetch.json, dpf_osm_<city>.json); then run build_data.py.
Writes raw/fetch_log.json with the date of each download.

Please respect the OSM API usage policy: this script waits between requests and identifies itself.
Data (c) OpenStreetMap contributors (ODbL); LEHD LODES (public domain).
"""
import gzip
import io
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "raw"
UA = "downtown-parking-footprint/1.0 (research; github.com/terbear15)"
CELL = 250.0
ACRE = 4046.856
THRESHOLD = 25          # jobs per acre
SEARCH_R = 12000        # m around city hall read from LODES
CORE_R = 3000           # densest cell must be within this distance of city hall

# id: (state, city hall lat, lon)
CITIES = {
    "albuquerque": ("nm", 35.0844, -106.6504), "atlanta": ("ga", 33.7490, -84.3880), "austin": ("tx", 30.2672, -97.7431),
    "baltimore": ("md", 39.2909, -76.6107), "birmingham": ("al", 33.5186, -86.8104), "boston": ("ma", 42.3603, -71.0580),
    "buffalo": ("ny", 42.8864, -78.8784), "charlotte": ("nc", 35.2271, -80.8431), "chicago": ("il", 41.8837, -87.6319),
    "cincinnati": ("oh", 39.1031, -84.5120), "cleveland": ("oh", 41.4993, -81.6944), "columbus": ("oh", 39.9612, -82.9988),
    "dallas": ("tx", 32.7767, -96.7970), "denver": ("co", 39.7392, -104.9903), "detroit": ("mi", 42.3314, -83.0458),
    "elpaso": ("tx", 31.7587, -106.4869), "hartford": ("ct", 41.7658, -72.6734), "houston": ("tx", 29.7604, -95.3698),
    "indianapolis": ("in", 39.7684, -86.1581), "jacksonville": ("fl", 30.3322, -81.6557), "kansascity": ("mo", 39.0997, -94.5786),
    "lasvegas": ("nv", 36.1716, -115.1391), "losangeles": ("ca", 34.0537, -118.2427), "louisville": ("ky", 38.2527, -85.7585),
    "memphis": ("tn", 35.1495, -90.0490), "miami": ("fl", 25.7743, -80.1937), "milwaukee": ("wi", 43.0389, -87.9065),
    "minneapolis": ("mn", 44.9778, -93.2650), "nashville": ("tn", 36.1627, -86.7816), "neworleans": ("la", 29.9511, -90.0715),
    "newyork": ("ny", 40.7831, -73.9712), "oklahomacity": ("ok", 35.4676, -97.5164), "omaha": ("ne", 41.2565, -95.9345),
    "orlando": ("fl", 28.5384, -81.3789), "philadelphia": ("pa", 39.9526, -75.1652), "phoenix": ("az", 33.4484, -112.0740),
    "pittsburgh": ("pa", 40.4406, -79.9959), "portland": ("or", 45.5152, -122.6784), "raleigh": ("nc", 35.7796, -78.6382),
    "richmond": ("va", 37.5407, -77.4360), "sacramento": ("ca", 38.5816, -121.4944), "saltlakecity": ("ut", 40.7608, -111.8910),
    "sanantonio": ("tx", 29.4241, -98.4936), "sandiego": ("ca", 32.7157, -117.1611), "sanfrancisco": ("ca", 37.7880, -122.4075),
    "seattle": ("wa", 47.6062, -122.3321), "stlouis": ("mo", 38.6270, -90.1994), "tampa": ("fl", 27.9506, -82.4572),
    "tucson": ("az", 32.2217, -110.9747), "washington": ("dc", 38.8951, -77.0306),
}
MANHATTAN = "36061"


def get(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return 400, b""
            if e.code in (404,):
                return e.code, b""
            time.sleep(10 * (k + 1))
        except Exception:
            time.sleep(5 * (k + 1))
    raise RuntimeError("failed: " + url)


def gz_lines(url):
    status, body = get(url)
    if status != 200:
        raise RuntimeError(f"{status} {url}")
    with gzip.open(io.BytesIO(body), "rt") as f:
        yield from f


def lodes_state(st, cities):
    blocks = {}
    header = True
    nyc = []
    for line in gz_lines(f"https://lehd.ces.census.gov/data/lodes/LODES8/{st}/{st}_xwalk.csv.gz"):
        if header:
            header = False
            continue
        f = line.rstrip("\n").split(",")
        lat, lon = float(f[-3]), float(f[-2])
        if st == "ny" and f[0].startswith(MANHATTAN):
            nyc.append((lat, lon))
        for cid in cities:
            _, la0, lo0 = CITIES[cid]
            dy = (lat - la0) * 111320
            dx = (lon - lo0) * 111320 * math.cos(math.radians(la0))
            if dx * dx + dy * dy < SEARCH_R ** 2:
                blocks[f[0]] = (lat, lon)
                break
    jobs, year = {}, None
    for y in (2023, 2022, 2021):
        try:
            header = True
            for line in gz_lines(f"https://lehd.ces.census.gov/data/lodes/LODES8/{st}/wac/{st}_wac_S000_JT00_{y}.csv.gz"):
                if header:
                    header = False
                    continue
                f = line.split(",", 2)
                if f[0] in blocks:
                    jobs[f[0]] = int(f[1])
            year = y
            break
        except RuntimeError:
            jobs = {}
    return blocks, jobs, year, nyc


def boundary(cid, blocks, jobs, year):
    st, lat0, lon0 = CITIES[cid]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 111320
    g = {}
    for b, j in jobs.items():
        la, lo = blocks[b]
        x, y = (lo - lon0) * kx, (la - lat0) * ky
        if abs(x) > 8000 or abs(y) > 8000:
            continue
        k = (math.floor(x / CELL), math.floor(y / CELL))
        g[k] = g.get(k, 0) + j
    ca = CELL * CELL / ACRE
    sm = {}
    for (i, j) in list(g):
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                k = (i + a, j + b)
                if k not in sm:
                    sm[k] = sum(g.get((k[0] + p, k[1] + q), 0) for p in (-1, 0, 1) for q in (-1, 0, 1)) / 9 / ca
    best, bv = None, -1
    for (i, j), v in sm.items():
        if math.hypot((i + .5) * CELL, (j + .5) * CELL) < CORE_R and v > bv:
            best, bv = (i, j), v
    cells, stack = {best}, [best]
    while stack:
        i, j = stack.pop()
        for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + a, j + b)
            if n not in cells and sm.get(n, 0) >= THRESHOLD:
                cells.add(n)
                stack.append(n)
    cells = fill_holes(cells)
    jobs_in = sum(g.get(c, 0) for c in cells)
    return {"city": cid, "state": st, "lat0": lat0, "lon0": lon0, "kx": kx, "ky": ky, "cell": CELL,
            "cells": sorted(list(c) for c in cells), "jobs": jobs_in, "lodesYear": year,
            "rule": "LODES WAC C000 jobs/acre, 250 m cells, 3x3 mean >= 25, 4-connected cluster containing densest cell within 3 km of city hall, holes filled",
            "core": {"cell": list(best), "jobsPerAcre": round(bv)}}


def fill_holes(cells):
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
    out, q = set(), [(x0, y0)]
    while q:
        c = q.pop()
        if c in out or c in cells or not (x0 <= c[0] <= x1 and y0 <= c[1] <= y1):
            continue
        out.add(c)
        q += [(c[0] + 1, c[1]), (c[0] - 1, c[1]), (c[0], c[1] + 1), (c[0], c[1] - 1)]
    return {(i, j) for i in range(x0 + 1, x1) for j in range(y0 + 1, y1) if (i, j) not in out} | cells


def manhattan(nyc):
    st, lat0, lon0 = CITIES["newyork"]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 111320
    cells = fill_holes({(math.floor((lo - lon0) * kx / CELL), math.floor((la - lat0) * ky / CELL)) for la, lo in nyc})
    return {"city": "newyork", "state": "ny", "lat0": lat0, "lon0": lon0, "kx": kx, "ky": ky, "cell": CELL,
            "cells": sorted(list(c) for c in cells), "jobs": None, "lodesYear": 2023,
            "rule": "Special case: all of Manhattan (New York County). 250 m cells containing a 2020 census block centroid in county 36061.",
            "core": {"latlon": [40.7527, -73.9772], "note": "Midtown (Grand Central)"}}


def is_rail(t):
    return (t.get("railway") in ("station", "halt", "tram_stop", "subway_entrance") or "station" in t
            or ("public_transport" in t and any(t.get(m) == "yes" for m in ("train", "subway", "light_rail", "tram"))))


def is_stop(t):
    return t.get("highway") == "bus_stop" or t.get("public_transport") in ("platform", "stop_position", "station") or is_rail(t)


def osm_map(s, w, n, e, depth=0):
    status, body = get(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}")
    time.sleep(0.4)
    if status == 400 and depth < 4:
        mx, my = (w + e) / 2, (s + n) / 2
        out = []
        for b in ((s, w, my, mx), (s, mx, my, e), (my, w, n, mx), (my, mx, n, e)):
            out += osm_map(*b, depth + 1)
        return out
    if status != 200:
        raise RuntimeError(f"OSM {status}")
    return [json.loads(body)]


def osm_city(b):
    lat0, lon0, kx, ky, C = b["lat0"], b["lon0"], b["kx"], b["ky"], b["cell"]
    dil = {(i + a, j + c) for i, j in b["cells"] for a in range(-2, 3) for c in range(-2, 3)}
    tiles = {(i // 3, j // 3) for i, j in dil}
    nodes, ways, rels, stops, bldg = {}, {}, {}, {}, {}
    for n_, (bi, bj) in enumerate(sorted(tiles)):
        x0, y0 = bi * 3 * C, bj * 3 * C
        for part in osm_map(lat0 + y0 / ky, lon0 + x0 / kx, lat0 + (y0 + 3 * C) / ky, lon0 + (x0 + 3 * C) / kx):
            for el in part["elements"]:
                t = el.get("tags", {})
                if el["type"] == "node":
                    nodes[el["id"]] = (el["lat"], el["lon"])
                    if t and is_stop(t):
                        stops[el["id"]] = [round(el["lat"] * 1e5), round(el["lon"] * 1e5), 1 if is_rail(t) else 0]
                elif el["type"] == "way":
                    if t.get("amenity") == "parking" or "building" in t:
                        ways[el["id"]] = {"nodes": el["nodes"], "tags": t}
                    elif t.get("public_transport") == "platform" or t.get("railway") in ("platform", "station"):
                        ways[el["id"]] = {"nodes": el["nodes"], "tags": t, "stop": 1}
                elif el["type"] == "relation" and t.get("amenity") == "parking":
                    rels[el["id"]] = {"members": el["members"], "tags": t}
        print(f"  tile {n_ + 1}/{len(tiles)}", end="\r", flush=True)
    for rid, r in rels.items():
        if any(m["type"] == "way" and m["ref"] not in ways for m in r["members"]):
            status, body = get(f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full.json")
            if status == 200:
                for el in json.loads(body)["elements"]:
                    if el["type"] == "node":
                        nodes[el["id"]] = (el["lat"], el["lon"])
                    elif el["type"] == "way":
                        ways[el["id"]] = {"nodes": el["nodes"], "tags": el.get("tags", {}), "member": 1}

    def enc(ids):
        pts = [(round(nodes[i][1] * 1e5), round(nodes[i][0] * 1e5)) for i in ids if i in nodes]
        if len(pts) < 3:
            return None
        o = [pts[0][0], pts[0][1]]
        for k in range(1, len(pts)):
            o += [pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]
        return " ".join(map(str, o))

    keep = lambda t: {k: t.get(k) for k in ("name", "parking", "fee", "access", "capacity", "operator")}
    lots = []
    for wid, w in ways.items():
        if w["tags"].get("amenity") == "parking":
            g = enc(w["nodes"])
            if g:
                lots.append({"id": f"w{wid}", "tags": keep(w["tags"]), "outer": [g]})
    for rid, r in rels.items():
        outer, inner = [], []
        for m in r["members"]:
            if m["type"] == "way" and m["ref"] in ways:
                g = enc(ways[m["ref"]]["nodes"])
                if g:
                    (inner if m.get("role") == "inner" else outer).append(g)
        if outer:
            lots.append({"id": f"r{rid}", "tags": keep(r["tags"]), "outer": outer, "inner": inner})
    for w in ways.values():
        if "building" not in w["tags"]:
            continue
        pts = [((nodes[i][1] - lon0) * kx, (nodes[i][0] - lat0) * ky) for i in w["nodes"] if i in nodes]
        if len(pts) < 3:
            continue
        a = abs(sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts)))) / 2
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        k = f"{math.floor(cx / C)},{math.floor(cy / C)}"
        bldg[k] = bldg.get(k, 0) + a
    for wid, w in ways.items():
        if w.get("stop") and w["nodes"] and w["nodes"][0] in nodes:
            la, lo = nodes[w["nodes"][0]]
            stops[f"w{wid}"] = [round(la * 1e5), round(lo * 1e5), 1 if is_rail(w["tags"]) else 0]
    return {"kind": "dpf_osm", "city": b["city"], "fetched": datetime.now(timezone.utc).isoformat(), "lat0": lat0, "lon0": lon0,
            "kx": kx, "ky": ky, "cell": C, "lots": lots, "bldg": {k: round(v) for k, v in bldg.items()}, "stops": list(stops.values())}


def main():
    wanted = sys.argv[1:] or sorted(CITIES)
    RAW.mkdir(exist_ok=True)
    log_path = RAW / "fetch_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {}
    by_state = {}
    for c in wanted:
        by_state.setdefault(CITIES[c][0], []).append(c)
    bounds = {}
    for st, cs in sorted(by_state.items()):
        print("LODES", st, cs)
        blocks, jobs, year, nyc = lodes_state(st, [c for c in cs if c != "newyork"])
        for c in cs:
            bounds[c] = manhattan(nyc) if c == "newyork" else boundary(c, blocks, jobs, year)
    (RAW / "dpf_boundaries_fetch.json").write_text(json.dumps(bounds))
    for c in wanted:
        print("OSM", c)
        data = osm_city(bounds[c])
        (RAW / f"dpf_osm_{c}.json").write_text(json.dumps(data, separators=(",", ":")))
        log[c] = {"osm": data["fetched"], "lodesYear": bounds[c]["lodesYear"], "lots": len(data["lots"])}
        log_path.write_text(json.dumps(log, indent=1))
    print("done. Now run: python3 python/build_data.py")


if __name__ == "__main__":
    main()
