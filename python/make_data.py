"""Write the city list the demo map loads.

Each city has a centre point and an approximate downtown bounding box
(south, west, north, east). The boxes are rough illustrative extents,
not official downtown boundaries. Parking polygons are fetched live
from OpenStreetMap in the browser; no parking numbers are stored here.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "cities.json"

cities = [
    {"id": "philadelphia", "name": "Philadelphia", "state": "PA", "center": [-75.1630, 39.9526], "bbox": [39.9450, -75.1800, 39.9600, -75.1420]},
    {"id": "pittsburgh", "name": "Pittsburgh", "state": "PA", "center": [-80.0000, 40.4406], "bbox": [40.4350, -80.0100, 40.4460, -79.9900]},
    {"id": "baltimore", "name": "Baltimore", "state": "MD", "center": [-76.6150, 39.2900], "bbox": [39.2820, -76.6250, 39.2970, -76.6050]},
    {"id": "houston", "name": "Houston", "state": "TX", "center": [-95.3650, 29.7570], "bbox": [29.7480, -95.3750, 29.7650, -95.3550]},
    {"id": "arlington", "name": "Arlington", "state": "TX", "center": [-97.1080, 32.7360], "bbox": [32.7250, -97.1200, 32.7420, -97.0950]},
]

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(cities, indent=2), encoding="utf-8")
print(f"wrote {OUT} ({len(cities)} cities)")
