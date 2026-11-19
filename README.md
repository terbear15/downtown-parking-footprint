# Downtown Parking Footprint

How much downtown land do U.S. cities give to surface parking, and which lots screen as redevelopment candidates?

Live site: https://terbear15.github.io/downtown-parking-footprint/

- **Q1 · Footprint (measurement):** surface parking area and share of downtown land in 24 downtowns.
- **Q2 · Candidates (screening):** each lot is scored on four open-data criteria (size ≥ 1.5 acres, ≤ 0.5 mile from the downtown core, transit stop ≤ 0.25 mile, building coverage above the downtown median). Zoning is not verified yet. Scores are screening results, not recommendations.

## Downtown boundary
One rule for every city: LODES 8 workplace jobs (2023; Detroit 2021) aggregated to 250 m cells, 3×3 mean ≥ 25 jobs/acre, the connected cluster containing the densest cell within 3 km of city hall, holes filled. Manhattan is a special case (whole borough).

## Layout
```
raw/                     downloads made in the browser (LODES boundaries, OSM extracts)
python/build_data.py     computes Q1 metrics and Q2 scores -> docs/data/
java/src/SiteBuilder.java  stamps build/data dates into java/template/index.html -> docs/index.html
docs/                    GitHub Pages site (MapLibre GL JS + OpenFreeMap tiles)
docs/data/manifest.json  counts, totals and SHA-256 of every data file
```

## Rebuild
```
python3 python/build_data.py
javac -d build java/src/SiteBuilder.java && java -cp build SiteBuilder
```

## Data and credits
Parking lots, buildings and transit stops © OpenStreetMap contributors (ODbL). Jobs: U.S. Census Bureau LEHD LODES 8. Base map: OpenFreeMap © OpenMapTiles. Rendering: MapLibre GL JS.
OSM figures are a lower bound: unmapped lots are not counted.
