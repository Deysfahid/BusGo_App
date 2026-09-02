#!/usr/bin/env node
/**
 * Import real bus-stop coordinates from OpenStreetMap into BusGo.
 *
 * OSM carries surveyed `highway=bus_stop` nodes - the actual stop position,
 * not an area centre - which is what the 100 m geofence needs.
 *
 * Usage (dry run first, nothing is written without --apply):
 *
 *   node scripts/import-osm-stops.mjs --filter "TTMC|Bus Station|Bus Stand"
 *   node scripts/import-osm-stops.mjs --filter "Marathahalli" --apply
 *   node scripts/import-osm-stops.mjs --bbox 13.00,77.55,13.15,77.65 --apply
 *
 * Options:
 *   --bbox   south,west,north,east      (default: Bengaluru metro area)
 *   --filter <regex>                    only stops whose name matches
 *   --limit  <n>                        cap how many are imported (default 200)
 *   --api    <url>                      BusGo API base (default http://localhost:8080)
 *   --apply                             actually write; omit for a dry run
 *
 * Credentials come from the environment so they are never stored in the repo:
 *   set BUSGO_ADMIN_EMAIL=admin@busgo.ai
 *   set BUSGO_ADMIN_PASSWORD=...
 * or pass an existing token with BUSGO_ADMIN_TOKEN.
 */

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes('--' + name);

const BBOX = opt('bbox', '12.60,77.30,13.40,77.90');
const FILTER = opt('filter', null);
const LIMIT = Number(opt('limit', 200));
const API = opt('api', 'http://localhost:8080');
const APPLY = flag('apply');

const OVERPASS = 'https://overpass-api.de/api/interpreter';

async function overpassStops(bbox) {
  const query = `[out:json][timeout:120];node["highway"="bus_stop"](${bbox});out body;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'BusGoAI-stop-import/1.0',
    },
  });
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) {
    throw new Error(`Overpass returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text).elements.filter((e) => e.tags?.name && e.lat != null);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function getToken() {
  if (process.env.BUSGO_ADMIN_TOKEN) return process.env.BUSGO_ADMIN_TOKEN;
  const email = process.env.BUSGO_ADMIN_EMAIL;
  const password = process.env.BUSGO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set BUSGO_ADMIN_TOKEN, or BUSGO_ADMIN_EMAIL and BUSGO_ADMIN_PASSWORD, before using --apply.'
    );
  }
  return (await api('/api/auth/login', { method: 'POST', body: { email, password } })).data.token;
}

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

(async () => {
  console.log(`Querying OpenStreetMap for bus stops in [${BBOX}] ...`);
  let stops = await overpassStops(BBOX);
  console.log(`  ${stops.length} named bus stops found`);

  if (FILTER) {
    const rx = new RegExp(FILTER, 'i');
    stops = stops.filter((e) => rx.test(e.tags.name));
    console.log(`  ${stops.length} match /${FILTER}/i`);
  }

  // Collapse OSM's separate nodes for each direction of travel into one entry.
  const byName = new Map();
  for (const e of stops) {
    const key = normalise(e.tags.name);
    if (!byName.has(key)) byName.set(key, e);
  }
  let candidates = [...byName.values()].sort((a, b) => a.tags.name.localeCompare(b.tags.name));
  console.log(`  ${candidates.length} after de-duplicating by name`);

  // A token is required to write, and lets a dry run skip stops already stored.
  let token;
  try {
    token = await getToken();
  } catch (err) {
    if (APPLY) throw err;
    console.log('  (no credentials set - cannot check for duplicates in this dry run)');
  }

  let fresh = candidates;
  if (token) {
    const existing = (await api('/api/admin/stops', { token })).data ?? [];
    const existingNames = new Set(existing.map((s) => normalise(s.name)));
    fresh = candidates.filter((e) => !existingNames.has(normalise(e.tags.name)));
    console.log(`  ${candidates.length - fresh.length} already in the database, ${fresh.length} new`);
  }

  const toImport = fresh.slice(0, LIMIT);
  if (fresh.length > LIMIT) {
    console.log(`  capped at --limit ${LIMIT}`);
  }

  console.log('');
  for (const e of toImport) {
    console.log(`  ${e.tags.name.padEnd(50)} ${e.lat.toFixed(6)}, ${e.lon.toFixed(6)}`);
  }

  if (!APPLY) {
    console.log(`\nDry run - nothing written. Re-run with --apply to import these ${toImport.length} stop(s).`);
    return;
  }

  let ok = 0;
  for (const e of toImport) {
    try {
      await api('/api/admin/stops', {
        method: 'POST',
        token,
        body: { name: e.tags.name, latitude: e.lat, longitude: e.lon },
      });
      ok++;
    } catch (err) {
      console.log(`  ! failed on "${e.tags.name}": ${err.message}`);
    }
  }
  console.log(`\nImported ${ok} of ${toImport.length} stop(s).`);
})().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
