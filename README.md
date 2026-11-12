# Surface Parking Demo

Static demo: a Leaflet map with buttons, served by GitHub Pages from `docs/`.

- `python/make_data.py` writes `docs/data/sample.geojson` (placeholder values).
- `java/src/SiteBuilder.java` writes `docs/index.html` (build step only).
- The browser runs plain JavaScript for the map and buttons. Java does not run in the browser.

## Rebuild

    python3 python/make_data.py
    javac -d java/out java/src/SiteBuilder.java
    java -cp java/out SiteBuilder

Values are placeholders, not results.
