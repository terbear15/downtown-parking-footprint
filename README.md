# Surface Parking Demo

A dark, minimal map of downtown surface parking in five U.S. cities.

- `python/make_data.py` writes `docs/data/cities.json` (city centres and rough downtown boxes).
- `docs/data/lots/<city>.txt` holds surface lots from OpenStreetMap (downloaded 2026-11-12), one lot per line. `python/check_lots.py` checksums these files.
- `java/src/SiteBuilder.java` stamps `java/template/index.html` into `docs/index.html`. Java runs at build time only.
- In the browser, MapLibre draws an OpenFreeMap vector basemap styled as white streets on black, limited to the continental U.S.

Lots are what OSM contributors have mapped. OSM is incomplete, so areas are lower bounds and not model output. Real-time occupancy is not shown.

Map data (c) OpenStreetMap contributors, ODbL. Basemap: OpenFreeMap, OpenMapTiles.

## Rebuild

    python3 python/make_data.py
    javac -d java/out java/src/SiteBuilder.java
    java -cp java/out SiteBuilder
