"""Build raw/ai_candidates.json: lots shown only on request and used only for the upper end of the range.

Two kinds:
  rough       - a reviewer confirmed the lot is surface parking but marked the outline as wrong
                (rounds 6-8, answer "rough"); latest outline per lot, dropped if the lot was later
                accepted with a fitting outline (it is then in ai_confirmed.json).
  unverified  - proposals of the final model that nobody has reviewed (raw/final_detections.json).

Upper bound = OSM lots + confirmed lots + rough lots + 0.92 x unverified (0.92 = share of real lots
in the strict round-8 review).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def pip(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def main():
    confirmed = json.loads((ROOT / "raw/ai_confirmed.json").read_text())
    rough = []  # newest round first so the latest outline wins
    for rnd in range(9, 5, -1):
        sp, rp = ROOT / f"docs/review/review_r{rnd}.json", ROOT / f"raw/review_round{rnd}_results.json"
        if not (sp.exists() and rp.exists()):
            continue
        ans = json.loads(rp.read_text())["answers"]
        for d in json.loads(sp.read_text())["detections"]:
            a = ans.get(d["id"])
            if a not in ("rough", "yes", "no") or not d.get("poly") or len(d["poly"]) < 3:
                continue
            c = centroid(d["poly"])
            # a later answer about the same lot already decided it
            if any(r["city"] == d["city"] and (pip(c, r["poly"]) or pip(centroid(r["poly"]), d["poly"])) for r in rough):
                continue
            rough.append({"id": d["id"], "city": d["city"], "round": rnd, "answer": a, "poly": d["poly"], "prob": d.get("prob", 0)})
    keep = []
    for r in rough:
        if r["answer"] != "rough":
            continue
        c = centroid(r["poly"])
        if any(k["city"] == r["city"] and (pip(c, k["poly"]) or pip(centroid(k["poly"]), r["poly"])) for k in confirmed):
            continue
        keep.append({"id": r["id"], "city": r["city"], "kind": "rough", "round": r["round"], "prob": r["prob"], "poly": r["poly"]})
    final = []
    fp = ROOT / "raw/final_detections.json"
    if fp.exists():
        for d in json.loads(fp.read_text())["detections"]:
            final.append({"id": d["id"], "city": d["city"], "kind": "unverified", "prob": d["prob"], "poly": d["poly"]})
    out = {"precisionUnverified": 0.92, "detections": keep + final}
    (ROOT / "raw/ai_candidates.json").write_text(json.dumps(out, separators=(",", ":")))
    print(len(keep), "rough (confirmed lot, approximate outline);", len(final), "unverified")


if __name__ == "__main__":
    main()
