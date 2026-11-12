"""Write placeholder GeoJSON points for the demo map.

PLACEHOLDER VALUES ONLY. parking_share_pct is 0.0 for every city and is
NOT an analysis result. Replace with model output once the pipeline runs.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "sample.geojson"

cities = [
    {"name": "Philadelphia (placeholder)", "lon": -75.1652, "lat": 39.9526},
    {"name": "Pittsburgh (placeholder)", "lon": -80.0000, "lat": 40.4406},
]

geojson = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": c["name"], "parking_share_pct": 0.0, "placeholder": True},
            "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
        }
        for c in cities
    ],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"wrote {OUT}")
