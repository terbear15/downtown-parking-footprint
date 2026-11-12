# Surface Parking Demo

Dark, minimal map of downtown surface parking.

- `python/make_data.py` writes `docs/data/cities.json` (city centres and rough downtown boxes).
- `java/src/SiteBuilder.java` stamps `java/template/index.html` into `docs/index.html`. Java runs at build time only.
- In the browser, MapLibre draws an OpenFreeMap vector basemap styled as white streets on black. Clicking a city fetches OpenStreetMap `amenity=parking` polygons live from Overpass and shows count, area and share of the box.

Numbers come from OSM labels, which are incomplete. They are lower bounds and not model output. Real-time occupancy is not shown.

## Rebuild

    python3 python/make_data.py
    javac -d java/out java/src/SiteBuilder.java
    java -cp java/out SiteBuilder
