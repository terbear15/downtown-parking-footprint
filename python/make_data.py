"""Write a small placeholder CSV of city parking shares.

PLACEHOLDER VALUES ONLY. These numbers are illustrative and are NOT
analysis results. Replace them with model outputs once the pipeline runs.
"""
import csv
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "sample.csv"

rows = [
    {"city": "City A (placeholder)", "parking_share_pct": 0.0, "note": "replace with model output"},
    {"city": "City B (placeholder)", "parking_share_pct": 0.0, "note": "replace with model output"},
]

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["city", "parking_share_pct", "note"])
    writer.writeheader()
    writer.writerows(rows)

print(f"wrote {OUT}")
