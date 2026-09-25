#!/usr/bin/env node
/**
 * BMTC (Bengaluru) real route/stop importer for BusGo.
 *
 * SOURCE  : https://github.com/Vonter/bmtc-gtfs  (unofficial GTFS, ODbL, scraped
 *           from the Namma BMTC app). We use two derivative files, which are the
 *           easiest and safest to map:
 *             - csv/routes.csv      : one row per DIRECTIONAL route pattern, with
 *                                     name (route number), full_name (origin →
 *                                     destination), direction_id, and an ORDERED
 *                                     stop_list of stop NAMES.
 *             - geojson/stops.geojson : stop name -> [lon, lat] coordinates.
 *
 * TARGET  : the EXISTING BusGo tables, unchanged:
 *             stops(name UNIQUE, latitude, longitude)
 *             routes(name, created_at, updated_at)
 *             route_stops(route_id, stop_id, stop_order)  UNIQUE(route_id, stop_id)
 *
 * SAFETY  : additive and idempotent. It NEVER deletes or overwrites existing rows.
 *           - dry-run : reads the source + the DB, prints a plan, writes NOTHING.
 *           - build-sql : writes staging CSVs + one transactional import.sql that
 *             uses ON CONFLICT / NOT EXISTS so re-running creates no duplicates.
 *           This script itself never writes to the database; the actual import is a
 *           separate, explicit `psql -f import.sql` step you run after review.
 *
 * NO schema change. NO new tables. NO change to app code, security, or GPS logic.
 *
 * Usage:
 *   node bmtc-import.mjs dry-run  --routes <routes.csv> --stops <stops.geojson>
 *   node bmtc-import.mjs build-sql --routes <routes.csv> --stops <stops.geojson> --out <dir>
 *
 * DB reads (dry-run "already exists" counts) use psql; set these env vars:
 *   PGHOST (default localhost) PGPORT (5432) PGUSER (postgres) PGDATABASE (busgo_dev)
 *   PGPASSWORD (required for the DB read; omit with --no-db to skip DB counts)
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// ---- Bengaluru / BMTC operating region. Coordinates outside are rejected. ----
const BBOX = { latMin: 12.6, latMax: 13.3, lonMin: 77.2, lonMax: 78.0 }
// Two stop records with the SAME name within this distance are treated as one
// physical stop; farther apart, they are a same-name-different-location conflict.
const SAME_STOP_M = 50
const CONFLICT_M = 200
const PSQL = process.env.BMTC_PSQL ||
  'C:/Program Files/PostgreSQL/17/bin/psql.exe'

// ------------------------------- arg parsing -------------------------------
const [, , cmd, ...rest] = process.argv
const args = {}
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a === '--no-db') args.noDb = true
  else if (a.startsWith('--')) { args[a.slice(2)] = rest[i + 1]; i++ }
}
if (!['dry-run', 'build-sql'].includes(cmd)) {
  console.error('Usage: node bmtc-import.mjs <dry-run|build-sql> --routes <routes.csv> --stops <stops.geojson> [--out <dir>] [--no-db]')
  process.exit(2)
}

// ------------------------------- helpers -----------------------------------
const normalise = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const round6 = (v) => Math.round(v * 1e6) / 1e6
function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000, r = Math.PI / 180
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}
const validCoord = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0 &&
  lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax

/** RFC-4180-ish CSV parser: handles double-quoted fields with embedded commas/newlines. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}
/** Parse a Python-repr list of strings: ['A', 'B', ...] -> ['A','B',...]. */
function parsePyList(s) {
  if (!s) return []
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(s)) !== null) out.push(m[1].replace(/\\'/g, "'"))
  return out
}
function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// ------------------------------- load source -------------------------------
function loadStops(geojsonPath) {
  const gj = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'))
  // normalise -> { name, lat, lon, valid }  (one physical stop per normalised name)
  const byNorm = new Map()
  let features = 0, collapsed = 0, sameNameConflict = 0
  for (const f of gj.features || []) {
    features++
    const name = f.properties?.name?.trim()
    const coords = f.geometry?.coordinates
    if (!name || !Array.isArray(coords)) continue
    const lon = Number(coords[0]), lat = Number(coords[1])
    const key = normalise(name)
    const ok = validCoord(lat, lon)
    const existing = byNorm.get(key)
    if (!existing) {
      byNorm.set(key, { name, lat: ok ? round6(lat) : null, lon: ok ? round6(lon) : null, valid: ok })
    } else {
      collapsed++
      // Fill coords if the first record lacked them and this one is valid.
      if (!existing.valid && ok) { existing.lat = round6(lat); existing.lon = round6(lon); existing.valid = true }
      else if (existing.valid && ok) {
        const d = haversineM(existing.lat, existing.lon, lat, lon)
        if (d > CONFLICT_M) sameNameConflict++ // same name, far apart: kept as one (name is UNIQUE in BusGo)
      }
    }
  }
  return { byNorm, features, collapsed, sameNameConflict }
}

function loadRoutes(routesPath) {
  const rows = parseCsv(fs.readFileSync(routesPath, 'utf8'))
  const header = rows.shift().map((h) => h.trim())
  const col = (n) => header.indexOf(n)
  const iName = col('name'), iFull = col('full_name'), iDir = col('direction_id')
  const iStops = col('stop_list'), iTrips = col('trip_count')
  const out = []
  for (const r of rows) {
    if (!r.length || r.every((c) => c === '')) continue
    out.push({
      routeNo: (r[iName] || '').trim(),
      fullName: (r[iFull] || '').trim(),
      directionId: (r[iDir] || '').trim(),
      tripCount: Number(r[iTrips] || 0) || 0,
      stopNames: parsePyList(r[iStops]),
    })
  }
  return out
}

// ------------------------------- build plan --------------------------------
function buildPlan(routesPath, stopsPath) {
  const stops = loadStops(stopsPath)
  const routes = loadRoutes(routesPath)

  const stagedStops = new Map()   // norm -> { name, lat, lon }
  const stagedRoutes = new Map()  // routeName -> true
  const routeStops = []           // { routeName, stopName, order }
  const reasons = { noRouteNo: 0, noFullName: 0, tooFewStops: 0 }
  let stopsNoCoords = 0, dupWithinRoute = 0, importedRoutes = 0, skippedRoutes = 0

  const ensureStop = (rawName) => {
    const key = normalise(rawName)
    if (stagedStops.has(key)) return stagedStops.get(key)
    const src = stops.byNorm.get(key)
    const rec = src
      ? { name: src.name, lat: src.valid ? src.lat : null, lon: src.valid ? src.lon : null }
      : { name: rawName.trim(), lat: null, lon: null } // referenced but no coords in geojson
    if (rec.lat == null) stopsNoCoords++
    stagedStops.set(key, rec)
    return rec
  }

  for (const r of routes) {
    if (!r.routeNo) { reasons.noRouteNo++; skippedRoutes++; continue }
    if (!r.fullName) { reasons.noFullName++; skippedRoutes++; continue }
    const routeName = `${r.routeNo} \u00b7 ${r.fullName}` // "285 · Origin → Destination"

    // Resolve ordered stops, dropping a stop that repeats within THIS route
    // (route_stops is UNIQUE(route_id, stop_id) - a stop can appear once per route).
    const seen = new Set()
    const ordered = []
    for (const nm of r.stopNames) {
      if (!nm || !nm.trim()) continue
      const key = normalise(nm)
      if (seen.has(key)) { dupWithinRoute++; continue }
      seen.add(key)
      ensureStop(nm)
      ordered.push(nm.trim())
    }
    if (ordered.length < 2) { reasons.tooFewStops++; skippedRoutes++; continue }

    if (!stagedRoutes.has(routeName)) stagedRoutes.set(routeName, true)
    let order = 1
    for (const nm of ordered) routeStops.push({ routeName, stopName: nm, order: order++ })
    importedRoutes++
  }

  return {
    stops, routes,
    stagedStops, stagedRoutes, routeStops,
    reasons, stopsNoCoords, dupWithinRoute, importedRoutes, skippedRoutes,
    totalTrips: routes.reduce((a, r) => a + r.tripCount, 0),
  }
}

// ------------------------------- DB reads ----------------------------------
function dbQuery(sql) {
  const env = { ...process.env }
  return execFileSync(PSQL, [
    '-h', process.env.PGHOST || 'localhost',
    '-p', process.env.PGPORT || '5432',
    '-U', process.env.PGUSER || 'postgres',
    '-d', process.env.PGDATABASE || 'busgo_dev',
    '-tAc', sql,
  ], { env, maxBuffer: 64 * 1024 * 1024 }).toString()
}
function dbNameSet(table) {
  const out = dbQuery(`select name from ${table}`)
  return new Set(out.split('\n').map((s) => normalise(s)).filter(Boolean))
}

// ------------------------------- main --------------------------------------
const plan = buildPlan(args.routes, args.stops)

let existingStopNorms = null, existingRouteNorms = null, dbErr = null
if (!args.noDb) {
  try {
    existingStopNorms = dbNameSet('stops')
    existingRouteNorms = dbNameSet('routes')
  } catch (e) { dbErr = e.message.split('\n')[0] }
}

const stopArr = [...plan.stagedStops.values()]
const routeArr = [...plan.stagedRoutes.keys()]
const newStops = existingStopNorms ? stopArr.filter((s) => !existingStopNorms.has(normalise(s.name))).length : null
const newRoutes = existingRouteNorms ? routeArr.filter((n) => !existingRouteNorms.has(normalise(n))).length : null

function printSummary() {
  const L = (k, v) => console.log(k.padEnd(46) + v)
  console.log('\n===== BMTC IMPORT DRY-RUN =====')
  L('Source routes.csv rows (directional patterns):', plan.routes.length)
  L('  Directional routes VALID (would import):', plan.importedRoutes)
  L('  Routes SKIPPED (invalid):', plan.skippedRoutes)
  L('    - no route number:', plan.reasons.noRouteNo)
  L('    - no origin/destination:', plan.reasons.noFullName)
  L('    - fewer than 2 usable stops:', plan.reasons.tooFewStops)
  console.log('')
  L('Source stops.geojson features:', plan.stops.features)
  L('  Duplicate stop records collapsed by name:', plan.stops.collapsed)
  L('  Same-name/different-location (>200m):', plan.stops.sameNameConflict)
  L('Unique physical stops referenced by routes:', plan.stagedStops.size)
  L('  Stops WITHOUT valid coordinates:', plan.stopsNoCoords)
  console.log('')
  L('Route-stop relationships (would insert):', plan.routeStops.length)
  L('  Duplicate stop-in-route occurrences dropped:', plan.dupWithinRoute)
  console.log('')
  L('Scheduled trips found (NOT imported*):', plan.totalTrips)
  console.log('  * BusGo has no timetable model; trips are created live by conductors.')
  console.log('')
  console.log('--- vs existing BusGo database ---')
  if (dbErr) { console.log('  (DB not read: ' + dbErr + ')') }
  else if (args.noDb) { console.log('  (skipped with --no-db)') }
  else {
    L('Stops that would be INSERTED (new):', newStops)
    L('Stops that already exist (skipped):', stopArr.length - newStops)
    L('Routes that would be INSERTED (new):', newRoutes)
    L('Routes that already exist (skipped):', routeArr.length - newRoutes)
    L('Records that would be UPDATED:', '0  (additive; existing rows never modified)')
    console.log('  route_stops: ' + plan.routeStops.length +
      ' staged; existing (route_id,stop_id) pairs are skipped by ON CONFLICT.')
  }
  console.log('===============================\n')
}

if (cmd === 'dry-run') {
  printSummary()
  process.exit(0)
}

// ------------------------------- build-sql ---------------------------------
const outDir = args.out || '.'
fs.mkdirSync(outDir, { recursive: true })
const p = (f) => path.join(outDir, f)

const stopCsv = ['name,latitude,longitude']
for (const s of stopArr) stopCsv.push([csvCell(s.name), s.lat ?? '', s.lon ?? ''].join(','))
fs.writeFileSync(p('stage_stops.csv'), stopCsv.join('\n'))

const routeCsv = ['name']
for (const n of routeArr) routeCsv.push(csvCell(n))
fs.writeFileSync(p('stage_routes.csv'), routeCsv.join('\n'))

const rsCsv = ['route_name,stop_name,stop_order']
for (const rs of plan.routeStops) rsCsv.push([csvCell(rs.routeName), csvCell(rs.stopName), rs.order].join(','))
fs.writeFileSync(p('stage_routestops.csv'), rsCsv.join('\n'))

// One transaction. Staging temp tables + set-based idempotent inserts.
// ON CONFLICT / NOT EXISTS make re-runs create no duplicates. Existing rows are
// never modified or deleted. Uses absolute \copy paths so psql -f works anywhere.
const abs = (f) => path.resolve(p(f)).replace(/\\/g, '/')
const sql = `-- BMTC additive import for BusGo. Idempotent. Review before running.
-- Existing stops/routes/route_stops/trips/tickets/users are NOT touched.
\\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _s_stops(name text, latitude double precision, longitude double precision) ON COMMIT DROP;
\\copy _s_stops FROM '${abs('stage_stops.csv')}' WITH (FORMAT csv, HEADER true);
INSERT INTO stops(name, latitude, longitude)
  SELECT name, latitude, longitude FROM _s_stops
  ON CONFLICT (name) DO NOTHING;          -- never overwrite an existing stop

CREATE TEMP TABLE _s_routes(name text) ON COMMIT DROP;
\\copy _s_routes FROM '${abs('stage_routes.csv')}' WITH (FORMAT csv, HEADER true);
INSERT INTO routes(name, created_at, updated_at)
  SELECT DISTINCT s.name, now(), now() FROM _s_routes s
  WHERE NOT EXISTS (SELECT 1 FROM routes r WHERE r.name = s.name);

CREATE TEMP TABLE _s_rs(route_name text, stop_name text, stop_order int) ON COMMIT DROP;
\\copy _s_rs FROM '${abs('stage_routestops.csv')}' WITH (FORMAT csv, HEADER true);
INSERT INTO route_stops(route_id, stop_id, stop_order)
  SELECT r.id, st.id, s.stop_order
  FROM _s_rs s
  JOIN routes r  ON r.name = s.route_name
  JOIN stops  st ON st.name = s.stop_name
  ON CONFLICT (route_id, stop_id) DO NOTHING;

-- Report what landed:
SELECT 'stops' AS table, count(*) FROM stops
UNION ALL SELECT 'routes', count(*) FROM routes
UNION ALL SELECT 'route_stops', count(*) FROM route_stops;

COMMIT;
`
fs.writeFileSync(p('import.sql'), sql)

printSummary()
console.log('Wrote staging files + import.sql to: ' + path.resolve(outDir))
console.log('\nTo APPLY the import to the LOCAL database (review first!):')
console.log(`  PGPASSWORD=... "${PSQL}" -h localhost -U postgres -d busgo_dev -f "${abs('import.sql')}"`)
console.log('\nThis script did NOT modify the database.')
