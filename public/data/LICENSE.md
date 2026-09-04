# Geographic data licence

The geographic data in `basemap.json` is © OpenStreetMap contributors and is
available under the Open Data Commons Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/

Attribution and contributor information: https://www.openstreetmap.org/copyright

This derived regional database uses an OpenStreetMap snapshot dated
2026-09-04T04:01:34Z, obtained via the public VK Maps Overpass API.
Extent: south 32.015, west 118.785, north 32.115, east 118.925 (WGS84).

Geometry is transformed into local metre coordinates, simplified and grouped
into SVG path layers. The transformation and source timestamp are included in
the JSON. This publicly downloadable file is the same geographic database
embedded in the application. The reproducible conversion script is
`scripts/build-basemap.cjs` in the source repository.

The data is not a real-time navigation service or a statement of vehicle access.
The separate coloured traffic overlay expresses the site's interpretation of
the cited notice. Uncoloured streets and paths have not been verified for access.
