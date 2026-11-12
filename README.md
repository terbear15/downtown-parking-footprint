# Surface Parking Demo

Static demo site for the surface-parking project.

- `python/make_data.py` writes `data/sample.csv` (placeholder values).
- `java/src/SiteBuilder.java` reads the CSV and writes `docs/index.html`.
- GitHub Pages serves `docs/`. Java runs at build time only; the browser runs plain HTML.

## Rebuild

    python3 python/make_data.py
    javac -d java/out java/src/SiteBuilder.java
    java -cp java/out SiteBuilder

Values in this demo are placeholders, not results.
