# BMTC → BusGo importer (additive, idempotent)

Imports **real Bengaluru BMTC** route and stop data into the **existing** BusGo
tables (`stops`, `routes`, `route_stops`). No schema change, no app change, no
change to GPS/geofence/auth. Existing rows are never modified or deleted.

## Source
[github.com/Vonter/bmtc-gtfs](https://github.com/Vonter/bmtc-gtfs) — unofficial
GTFS scraped from the Namma BMTC app, **ODbL** (attribution + share-alike). We use
two derivative files (easiest/safest to map):

- `csv/routes.csv` — one row per **directional** pattern: route number, `full_name`
  (origin → destination), `direction_id`, and an **ordered stop-name list**.
- `geojson/stops.geojson` — stop **name → [lon, lat]**.

Download them into a data dir (kept out of the repo), e.g.:

```bash
curl -sL -o routes.csv     https://raw.githubusercontent.com/Vonter/bmtc-gtfs/master/csv/routes.csv
curl -sL -o stops.geojson  https://raw.githubusercontent.com/Vonter/bmtc-gtfs/master/geojson/stops.geojson
```

## Mapping
| Source | BusGo | Notes |
|---|---|---|
| `routes.csv name` + `full_name` | `routes.name` = `"<number> · <origin → destination>"` | direction preserved (one Route per direction) |
| `stops.geojson name` | `stops.name` (UNIQUE) | dedup key |
| `stops.geojson [lon,lat]` | `stops.latitude/longitude` | validated to the Bengaluru bbox; invalid → null |
| `routes.csv stop_list` order | `route_stops.stop_order` | 1..n |
| route ↔ stop | `route_stops(route_id, stop_id)` | UNIQUE(route_id, stop_id) |
| `trip_count` / timetables | — | **not imported** (BusGo has no timetable model) |
| vehicle reg number | — | **not in the data**; conductor/admin assign the bus |

## Safety
- **dry-run** reads source + DB, prints a plan, writes nothing.
- **build-sql** writes staging CSVs + one transactional `import.sql`
  (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`) — re-running creates no duplicates.
- This script never writes to the database. The import is a separate `psql -f` step.

## Usage
```bash
# environment for the DB read in dry-run:
export PGPASSWORD=...   # PGHOST/PGPORT/PGUSER/PGDATABASE default to localhost/5432/postgres/busgo_dev

node bmtc-import.mjs dry-run   --routes routes.csv --stops stops.geojson
node bmtc-import.mjs build-sql --routes routes.csv --stops stops.geojson --out ./out
# review ./out/import.sql, then apply to the LOCAL db:
PGPASSWORD=... psql -h localhost -U postgres -d busgo_dev -f ./out/import.sql
```

## Known data-quality notes
- Same-name stops >200 m apart collapse to one (BusGo `stops.name` is UNIQUE) — reported.
- Stops referenced by a route but missing coordinates are created name-only and are
  safely ignored by the geofence (which skips null-coordinate stops).
- Importing the full network is large (~7.5k directional routes, ~5k stops, ~215k
  route-stops). Consider a curated subset first, and server-side route search before
  exposing the full set to the passenger autocomplete.
