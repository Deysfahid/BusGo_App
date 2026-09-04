import { useState, useEffect, useMemo, useRef } from 'react'
import { apiRequest } from '../lib/api'
import { Search, MapPin, Clock, Navigation, Bus, Sparkles, X, Users, ArrowRight } from 'lucide-react'
import { connectWebSocket, disconnectWebSocket } from '../lib/websocket'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Custom Bus Icon for Leaflet
const busIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16]
});

// A labelled marker so several buses on one route stay tellable apart at a glance.
// Stale buses (no GPS for a while) are dimmed and outlined rather than hidden.
const busLabelIcon = (label, stale, focused) => {
  // A labelled pill with a pointer beneath it, so a bus reads as a vehicle
  // rather than a generic pin, and the plate is legible without clicking.
  const fill = stale ? '#ffffff' : focused ? '#1a73e8' : '#ffffff'
  const text = stale ? '#a86800' : focused ? '#ffffff' : '#202124'
  const edge = stale ? '#f9ab00' : focused ? '#174ea6' : '#dadce0'
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;
        transform:scale(${focused ? 1.06 : 1});transition:transform .15s ease;">
        <div style="
          display:flex;align-items:center;gap:5px;
          background:${fill};color:${text};border:1px solid ${edge};
          border-radius:8px;padding:4px 9px 4px 7px;
          font:500 12px/1.2 Inter,system-ui,sans-serif;white-space:nowrap;
          box-shadow:0 1px 3px rgba(60,64,67,.3),0 4px 8px rgba(60,64,67,.15);
        "><span style="font-size:13px">🚌</span>${label}</div>
        <div style="width:0;height:0;margin-top:-1px;
          border-left:5px solid transparent;border-right:5px solid transparent;
          border-top:6px solid ${focused ? '#174ea6' : edge};"></div>
        <div style="width:7px;height:7px;border-radius:50%;margin-top:-1px;
          background:${stale ? '#f9ab00' : focused ? '#174ea6' : '#1a73e8'};
          box-shadow:0 0 0 2px #fff;"></div>
      </div>`,
    iconSize: null,
    iconAnchor: [26, 40],
    popupAnchor: [0, -42],
  })
}

// No GPS for this long means the marker is showing a last-known position.
const STALE_MS = 20000

// Smoothly recenters the map when the live GPS position changes, without
// remounting the whole MapContainer (which would otherwise flicker).
function RecenterMap({ lat, lon }) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lon != null) {
      map.setView([lat, lon], map.getZoom(), { animate: true })
    }
  }, [lat, lon, map])
  return null
}

// Fits the viewport around every active bus on the route. Re-fits only when the
// set of buses changes, not on every position tick, so the map doesn't fight the
// user while they pan. One bus just centres.
function FitToBuses({ positions, fitKey }) {
  const map = useMap()
  useEffect(() => {
    if (!positions.length) return
    if (positions.length === 1) {
      map.setView(positions[0], Math.max(map.getZoom(), 14), { animate: true })
      return
    }
    map.fitBounds(L.latLngBounds(positions).pad(0.25), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map])
  return null
}

// Pans to one bus when its card is clicked.
function PanTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView([target.lat, target.lon], Math.max(map.getZoom(), 15), { animate: true })
  }, [target, map])
  return null
}

/**
 * Nudges buses sharing (almost) the same coordinate onto a small circle so their
 * markers don't stack into one unreadable pile. Purely visual - the underlying
 * position in the popup and list is untouched.
 */
function spreadOverlaps(buses) {
  const groups = new Map()
  for (const b of buses) {
    const key = `${b.currentLat.toFixed(4)},${b.currentLon.toFixed(4)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(b)
  }
  const out = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push({ ...group[0], mapLat: group[0].currentLat, mapLon: group[0].currentLon })
      continue
    }
    const r = 0.00018 // ~20 m
    group.forEach((b, i) => {
      const angle = (2 * Math.PI * i) / group.length
      out.push({
        ...b,
        mapLat: b.currentLat + r * Math.cos(angle),
        mapLon: b.currentLon + r * Math.sin(angle),
      })
    })
  }
  return out
}

const getCrowdInfo = (crowdLevel) => {
  switch(crowdLevel) {
    case 'LOW': return { label: 'LOW CROWD', color: 'text-crowd-low', bg: 'bg-crowd-low' }
    case 'MEDIUM': return { label: 'MODERATE CROWD', color: 'text-crowd-mod', bg: 'bg-crowd-mod' }
    case 'HIGH': return { label: 'HIGH CROWD', color: 'text-crowd-high', bg: 'bg-crowd-high' }
    case 'FULL': return { label: 'FULL', color: 'text-crowd-full', bg: 'bg-crowd-full' }
    default: return { label: 'LOW CROWD', color: 'text-crowd-low', bg: 'bg-crowd-low' }
  }
}

// Bucket a predicted occupancy count into the same crowd levels used live.
const crowdFromOccupancy = (occ, cap) => {
  if (occ == null || !cap) return null
  const frac = occ / cap
  if (frac >= 0.9) return 'FULL'
  if (frac >= 0.6) return 'HIGH'
  if (frac >= 0.3) return 'MEDIUM'
  return 'LOW'
}

// LIVE  = a fix arrived within STALE_MS
// STALE = we have a position, but it is old
// NO GPS = the bus has never reported one (timestamp is null)
const gpsStateOf = (b, now) => {
  if (b.timestamp == null) return 'offline'
  return now - b.timestamp > STALE_MS ? 'stale' : 'live'
}
const isStaleAt = (b, now) => gpsStateOf(b, now) !== 'live'
const ageTextAt = (b, now) => {
  if (b.timestamp == null) return 'No GPS received'
  const secs = Math.max(0, Math.round((now - b.timestamp) / 1000))
  if (secs <= STALE_MS / 1000) return `Updated ${secs} sec ago`
  if (secs < 3600) return `Last update ${secs} sec ago`
  if (secs < 86400) return `Last update ${Math.round(secs / 3600)} hr ago`
  const days = Math.round(secs / 86400)
  return `Last update ${days} day${days === 1 ? '' : 's'} ago`
}

const OccupancyBar = ({ occupancy, capacity, crowdLevel }) => {
  const percent = Math.min(100, Math.round((occupancy / capacity) * 100))
  const crowd = getCrowdInfo(crowdLevel)
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
        <div className={`h-full rounded-full ${crowd.bg} transition-all duration-500`} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between items-center mt-2 text-xs">
        <span className="text-text-secondary numeric">{occupancy} / {capacity} occupied</span>
        <span className={`font-semibold ${crowd.color}`}>{crowd.label}</span>
      </div>
    </div>
  )
}

/* --- The bus card used in the route results list --- */
const BusCard = ({ b, now, focused, onFocus }) => {
  const gps = gpsStateOf(b, now)
  const cap = b.maxCapacity || 50
  const occ = b.currentOccupancy ?? 0
  const eta = b.remainingStopsEta?.[0]
  return (
    <button
      onClick={() => onFocus(b)}
      aria-label={`Focus ${b.busNumber || 'bus'} on the map`}
      className={`card-interactive p-4 ${focused ? 'border-accent bg-accent/[0.06]' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="font-bold tracking-tight truncate">{b.busNumber || `Bus #${b.busId}`}</span>
        <span className={gps === 'live' ? 'badge-live' : gps === 'stale' ? 'badge-stale' : 'badge-offline'}>
          <span className={`status-dot ${gps === 'live' ? 'bg-live pulse-live' : gps === 'stale' ? 'bg-stale' : 'bg-offline'}`} />
          {gps === 'live' ? 'Live' : gps === 'stale' ? 'Location stale' : 'No GPS'}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm mb-1 min-w-0">
        <span className="font-medium truncate">{b.currentStopName || 'Not reached yet'}</span>
        <ArrowRight size={14} className="text-text-muted shrink-0" />
        <span className="text-accent font-medium truncate">{b.nextStopName || 'End of route'}</span>
      </div>
      <p className="text-xs text-text-muted">{ageTextAt(b, now)}</p>

      <OccupancyBar occupancy={occ} capacity={cap} crowdLevel={b.crowdLevel} />

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle text-sm">
        <span className="flex items-center gap-1.5 text-text-secondary">
          <Users size={14} />
          <span className="numeric font-semibold text-text-primary">{b.availableSeats ?? cap - occ}</span> seats free
        </span>
        {eta && (
          <span className="flex items-center gap-1.5 text-text-secondary">
            <Clock size={14} />
            ETA <span className="numeric font-semibold text-text-primary">{eta.estimatedMinutes} min</span>
          </span>
        )}
      </div>
    </button>
  )
}

function Home() {
  const [activeTrips, setActiveTrips] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTripId, setSelectedTripId] = useState(null)

  // --- Route tracking: every active bus on one route, keyed by trip id ---
  const [routes, setRoutes] = useState([])
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [routeBuses, setRouteBuses] = useState({})   // tripId -> LiveTripStateDto
  const [routeLoading, setRouteLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [panTarget, setPanTarget] = useState(null)
  const [focusedTripId, setFocusedTripId] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Mirrors the selected route into a ref so the long-lived STOMP subscription
  // reads the current value instead of closing over a stale one.
  const selectedRouteRef = useRef(null)
  useEffect(() => { selectedRouteRef.current = selectedRoute }, [selectedRoute])

  // Ticks so "last seen" ages and stale badges stay honest.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Route list for the search suggestions.
  useEffect(() => {
    apiRequest('/api/routes').then(res => setRoutes(res.data || [])).catch(console.error)
  }, [])

  // Real-time WebSocket connection
  useEffect(() => {
    const fetchActiveTrips = async () => {
      try {
        const res = await apiRequest('/api/trips/active')
        const trips = res.data || []
        setActiveTrips(trips)

        // Seed each bus's last known position from the API, so a passenger who
        // opens the app mid-trip sees the bus straight away instead of an empty
        // map until the conductor's next ping arrives over the socket.
        const states = await Promise.all(
          trips.map((t) =>
            apiRequest(`/api/trips/${t.id}/live`)
              .then((r) => ({ id: t.id, live: r.data }))
              .catch(() => null)
          )
        )
        setActiveTrips((prev) =>
          prev.map((t) => {
            const seeded = states.find((s) => s && s.id === t.id)
            // Never overwrite a fresher state that arrived over the socket first.
            return seeded && !t.liveState ? { ...t, liveState: seeded.live } : t
          })
        )
      } catch (err) {
        console.error(err)
      }
    }
    fetchActiveTrips()

    connectWebSocket((stompClient) => {
      stompClient.subscribe('/topic/bus-updates', (msg) => {
        if (msg.body) {
          const updatedTrip = JSON.parse(msg.body)
          setActiveTrips((prevTrips) => {
            const tripExists = prevTrips.some(t => t.id === (updatedTrip.id || updatedTrip.tripId))
            if (updatedTrip.status === 'completed') {
               return prevTrips.filter(t => t.id !== (updatedTrip.id || updatedTrip.tripId))
            }
            if (tripExists) {
              return prevTrips.map(t => (t.id === (updatedTrip.id || updatedTrip.tripId)) ? { ...t, liveState: updatedTrip } : t)
            }
            // For brand new trips broadcasted
            return [...prevTrips, { id: updatedTrip.tripId || updatedTrip.id, liveState: updatedTrip }]
          })

          // Route view: update ONLY the bus this message belongs to. Keyed by
          // trip id, so one bus's GPS can never move another bus's marker.
          const route = selectedRouteRef.current
          if (route && updatedTrip.tripId) {
            setRouteBuses((prev) => {
              if (updatedTrip.status === 'completed') {
                if (!prev[updatedTrip.tripId]) return prev
                const next = { ...prev }
                delete next[updatedTrip.tripId]   // trip ended - drop it from the route map
                return next
              }
              if (updatedTrip.routeId !== route.id) return prev   // a bus on some other route
              return { ...prev, [updatedTrip.tripId]: updatedTrip }
            })
          }
        }
      })
    })

    return () => {
      disconnectWebSocket()
    }
  }, [])

  // --- Route search ---
  const routeEndpoints = (r) => {
    const s = [...(r.routeStops || [])].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
    if (s.length < 2) return null
    return { from: s[0].stop?.name, to: s[s.length - 1].stop?.name }
  }

  const routeSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^route\s+/, '')
    if (!q) return []
    return routes
      .filter(r => (r.name || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [searchQuery, routes])

  const selectRoute = async (route) => {
    setSelectedRoute(route)
    setSelectedTripId(null)
    setShowSuggestions(false)
    setSearchQuery(route.name)
    setRouteLoading(true)
    setRouteBuses({})
    setFocusedTripId(null)
    try {
      const res = await apiRequest(`/api/routes/${route.id}/active-buses`)
      const next = {}
      for (const b of res.data || []) next[b.tripId] = b
      setRouteBuses(next)
    } catch (err) {
      console.error(err)
    } finally {
      setRouteLoading(false)
    }
  }

  const clearRoute = () => {
    setSelectedRoute(null)
    setRouteBuses({})
    setSearchQuery('')
    setPanTarget(null)
    setFocusedTripId(null)
  }

  const focusBus = (b) => {
    setFocusedTripId(b.tripId)
    if (b.currentLat != null) setPanTarget({ lat: b.currentLat, lon: b.currentLon, t: Date.now() })
  }

  // Buses on the selected route that have a position to draw.
  const routeBusList = useMemo(
    () => Object.values(routeBuses).sort((a, b) => (a.busNumber || '').localeCompare(b.busNumber || '')),
    [routeBuses]
  )
  const mappable = useMemo(
    () => routeBusList.filter(b => b.currentLat != null && b.currentLon != null),
    [routeBusList]
  )
  const spread = useMemo(() => spreadOverlaps(mappable), [mappable])
  // Re-fit bounds when the set of buses changes, not on every position tick.
  const fitKey = useMemo(() => mappable.map(b => b.tripId).sort().join(','), [mappable])
  const positions = useMemo(() => mappable.map(b => [b.currentLat, b.currentLon]), [mappable])

  const filteredTrips = useMemo(() => {
    if (!searchQuery) return activeTrips
    const lowerQ = searchQuery.toLowerCase()
    return activeTrips.filter(
      (t) =>
        t.bus?.busNumber?.toLowerCase().includes(lowerQ) ||
        (t.route?.name || t.liveState?.routeName || '').toLowerCase().includes(lowerQ)
    )
  }, [activeTrips, searchQuery])

  const selectedTrip = useMemo(() => activeTrips.find(t => t.id === selectedTripId), [activeTrips, selectedTripId])

  const isStale = (b) => isStaleAt(b, now)
  const ageText = (b) => ageTextAt(b, now)

  const liveCount = routeBusList.length
  const routeEnds = selectedRoute ? routeEndpoints(selectedRoute) : null

  return (
    <div className="grid h-full lg:h-[calc(100vh-4rem)] min-h-0
                    grid-rows-[auto_minmax(300px,44vh)_1fr]
                    lg:grid-rows-[auto_1fr] lg:grid-cols-[400px_1fr]">

      {/* ============ Search header ============ */}
      <div className="lg:col-start-1 lg:row-start-1 bg-card border-b border-border-subtle lg:border-r z-20">

        <div className="p-5 pb-4 shrink-0">
          <h1 className="page-title mb-1">Where is your bus?</h1>
          <p className="text-sm text-text-secondary mb-4">Track every bus on a route, live.</p>

          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
            <input
              type="text"
              aria-label="Search bus route"
              placeholder="Search bus route or name"
              className="input pl-11 pr-11 rounded-full shadow-soft border-transparent focus:border-accent"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
            />
            {(searchQuery || selectedRoute) && (
              <button
                onClick={clearRoute}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
              >
                <X size={17} />
              </button>
            )}

            {showSuggestions && routeSuggestions.length > 0 && (
              <div className="absolute z-[500] left-0 right-0 mt-2 card shadow-lift overflow-hidden">
                {routeSuggestions.map(r => {
                  const ends = routeEndpoints(r)
                  return (
                    <button
                      key={r.id}
                      onClick={() => selectRoute(r)}
                      className="w-full text-left px-4 py-3 hover:bg-hover transition-colors border-b border-border-subtle last:border-b-0 flex items-start gap-3"
                    >
                      <span className="mt-0.5 shrink-0 text-accent"><Bus size={17} /></span>
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">{r.name}</span>
                        <span className="block text-xs text-text-secondary truncate">
                          {ends ? `${ends.from} → ${ends.to}` : `${(r.routeStops || []).length} stops`}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selectedRoute && (
            <div className="mt-4 flex items-center gap-2.5">
              <span className={liveCount > 0 ? 'badge-live' : 'badge-neutral'}>
                <span className={`status-dot ${liveCount > 0 ? 'bg-live pulse-live' : 'bg-offline'}`} />
                {liveCount} active {liveCount === 1 ? 'bus' : 'buses'}
              </span>
              {routeEnds && (
                <span className="text-xs text-text-secondary truncate">{routeEnds.from} → {routeEnds.to}</span>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ============ Map (dominant; first after the search on mobile) ============ */}
      <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 bg-dark relative min-h-0 flex flex-col border-b lg:border-b-0 border-border-subtle">
      <div className="w-full flex-1 flex flex-col bg-dark relative min-h-[55vh] lg:min-h-0 lg:h-full">
        {selectedRoute ? (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 w-full relative bg-dark min-h-[300px]">
              {mappable.length > 0 ? (
                <MapContainer
                  center={[mappable[0].currentLat, mappable[0].currentLon]}
                  zoom={13}
                  style={{ height: '100%', width: '100%', zIndex: 1 }}
                  key={`route-${selectedRoute.id}`}
                >
                  <FitToBuses positions={positions} fitKey={fitKey} />
                  <PanTo target={panTarget} />
                  <TileLayer
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  {spread.map((b) => (
                    <Marker
                      key={b.tripId}
                      position={[b.mapLat, b.mapLon]}
                      icon={busLabelIcon(b.busNumber || `#${b.busId}`, isStale(b), focusedTripId === b.tripId)}
                      eventHandlers={{ click: () => setFocusedTripId(b.tripId) }}
                    >
                      <Popup>
                        <div className="font-bold text-sm mb-0.5">{b.busNumber || `Bus #${b.busId}`}</div>
                        <div className="text-xs text-text-secondary mb-2">Route {b.routeName}</div>
                        <div className="text-sm mb-1">
                          {b.currentStopName || 'Not reached yet'} → <span className="text-accent">{b.nextStopName || 'End of route'}</span>
                        </div>
                        <div className="text-sm numeric">
                          {b.availableSeats ?? '—'} of {b.maxCapacity ?? '—'} seats free
                        </div>
                        {b.remainingStopsEta?.[0] && (
                          <div className="text-sm numeric">
                            {b.remainingStopsEta[0].stopName} in {b.remainingStopsEta[0].estimatedMinutes} min
                          </div>
                        )}
                        <div className={`text-xs mt-1.5 ${
                          gpsStateOf(b, now) === 'live' ? 'text-live'
                            : gpsStateOf(b, now) === 'stale' ? 'text-stale' : 'text-text-muted'
                        }`}>
                          {gpsStateOf(b, now) === 'live' ? '● LIVE · ' : gpsStateOf(b, now) === 'stale' ? '○ LOCATION STALE · ' : '○ NO GPS · '}
                          {ageText(b)}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              ) : (
                <div className="empty-state h-full">
                  <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center mb-4 border border-border-subtle">
                    <Bus size={28} className="opacity-30" />
                  </div>
                  <p className="font-semibold text-text-primary mb-1">
                    {routeLoading ? 'Finding active buses' : routeBusList.length === 0 ? 'No buses running' : 'Waiting for GPS'}
                  </p>
                  <p className="text-sm max-w-xs">
                    {routeLoading
                      ? 'Checking which buses are on this route.'
                      : routeBusList.length === 0
                        ? 'No buses are currently active on this route.'
                        : 'These buses have not reported a position yet.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : selectedTrip ? (
          <div className="flex flex-col h-full min-h-0">
            {/* Live Map Area */}
            <div className="h-1/2 min-h-[240px] w-full relative border-b border-border-subtle bg-dark">
               {selectedTrip.liveState?.currentLat && selectedTrip.liveState?.currentLon ? (
                  <MapContainer
                    center={[selectedTrip.liveState.currentLat, selectedTrip.liveState.currentLon]}
                    zoom={15}
                    style={{ height: "100%", width: "100%", zIndex: 1 }}
                    key={selectedTrip.id}
                  >
                    <RecenterMap lat={selectedTrip.liveState.currentLat} lon={selectedTrip.liveState.currentLon} />
                    <TileLayer
                      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <Marker
                      position={[selectedTrip.liveState.currentLat, selectedTrip.liveState.currentLon]}
                      icon={busIcon}
                    >
                      <Popup>
                        <div className="font-bold text-sm">{selectedTrip.bus?.busNumber}</div>
                        <div className="text-xs text-text-secondary">Route {selectedTrip.route?.name}</div>
                      </Popup>
                    </Marker>
                  </MapContainer>
               ) : (
                  <div className="empty-state h-full">
                     <Navigation size={26} className="opacity-30 mb-3" />
                     <p className="text-sm">Waiting for GPS signal…</p>
                  </div>
               )}
            </div>

            {/* Details Area */}
            <div className="flex-1 p-5 overflow-y-auto bg-dark min-h-0">
              {/* Live Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="card p-4">
                  <p className="eyebrow mb-2">Status</p>
                  <p className="font-semibold text-live flex items-center gap-2">
                    <span className="status-dot bg-live pulse-live" />
                    Live
                  </p>
                </div>
                <div className="card p-4">
                  <p className="eyebrow mb-2">Available Seats</p>
                  <p className="font-bold text-2xl numeric">{selectedTrip.liveState?.availableSeats !== undefined ? selectedTrip.liveState.availableSeats : (selectedTrip.bus?.capacity - selectedTrip.currentOccupancy)}</p>
                </div>
                <div className="card p-4">
                  <p className="eyebrow mb-2 flex items-center gap-1.5">
                    Crowd
                    {selectedTrip.liveState?.modelActive && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded normal-case tracking-normal">
                        <Sparkles size={10} /> AI
                      </span>
                    )}
                  </p>
                  <p className={`font-bold text-lg ${getCrowdInfo(selectedTrip.liveState?.predictedCrowdLevel || selectedTrip.liveState?.crowdLevel || 'LOW').color}`}>
                    {selectedTrip.liveState?.predictedCrowdLevel || selectedTrip.liveState?.crowdLevel || 'LOW'}
                  </p>
                </div>
                <div className="card p-4">
                  <p className="eyebrow mb-2">Next Stop</p>
                  <p className="font-semibold text-accent truncate">{selectedTrip.liveState?.nextStopName || 'Detecting…'}</p>
                </div>
              </div>

              {/* ETA Timeline */}
              <div className="card p-5">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Clock size={18} className="text-accent" /> Live ETA Timeline
                  {selectedTrip.liveState?.modelActive && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                      <Sparkles size={12} /> AI predictions
                    </span>
                  )}
                </h3>

                {!selectedTrip.liveState?.remainingStopsEta ? (
                  <div className="text-text-secondary p-5 text-center border border-dashed border-border-subtle rounded-xl text-sm">
                    Waiting for GPS sync from conductor…
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedTrip.liveState.remainingStopsEta.map((eta) => {
                      const cap = selectedTrip.liveState?.maxCapacity || selectedTrip.bus?.capacity || 50
                      const predLevel = crowdFromOccupancy(eta.predictedOccupancy, cap)
                      const predCrowd = predLevel ? getCrowdInfo(predLevel) : null
                      return (
                      <div key={eta.stopId} className="flex items-center justify-between gap-3 bg-dark p-3 rounded-xl border border-border-subtle">
                        <div className="flex items-center gap-3 min-w-0">
                           <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                              <MapPin size={15} className="text-accent" />
                           </div>
                           <div className="min-w-0">
                             <h4 className="font-semibold truncate">{eta.stopName}</h4>
                             {predCrowd && (
                               <span className="flex items-center gap-1.5 mt-0.5 text-xs text-text-secondary">
                                 <span className={`w-2 h-2 rounded-full ${predCrowd.bg} inline-block`} />
                                 <span className={`font-semibold ${predCrowd.color} numeric`}>~{eta.predictedOccupancy}</span>
                                 <span>expected on board</span>
                               </span>
                             )}
                           </div>
                        </div>
                        <span className={`px-3 py-1 rounded-lg text-sm font-bold numeric shrink-0 ${eta.estimatedMinutes <= 5 ? 'bg-live/15 text-live' : 'bg-hover text-text-secondary'}`}>
                          {eta.estimatedMinutes} min
                        </span>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state h-full">
            <div className="w-20 h-20 rounded-2xl bg-card border border-border-subtle flex items-center justify-center mb-5">
              <Bus size={36} className="opacity-30" />
            </div>
            <h2 className="page-title text-text-primary mb-2">Search a route</h2>
            <p className="text-center max-w-sm">
              Type a route number to see every bus running it right now, or pick a bus from the list for its full ETA timeline.
            </p>
          </div>
        )}
      </div>
      </div>

      {/* ============ Results list ============ */}
      <div className="lg:col-start-1 lg:row-start-2 bg-card lg:border-r border-border-subtle overflow-y-auto min-h-0">
        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 min-h-0">
          {selectedRoute ? (
            routeLoading ? (
              <>
                <div className="skeleton h-32 w-full" />
                <div className="skeleton h-32 w-full" />
              </>
            ) : routeBusList.length === 0 ? (
              <div className="empty-state">
                <div className="w-14 h-14 rounded-full bg-hover flex items-center justify-center mb-4">
                  <Bus size={24} className="opacity-40" />
                </div>
                <p className="font-semibold text-text-primary mb-1">No buses running</p>
                <p className="text-sm">No buses are currently active on this route.</p>
              </div>
            ) : (
              routeBusList.map((b) => <BusCard key={b.tripId} b={b} now={now} focused={focusedTripId === b.tripId} onFocus={focusBus} />)
            )
          ) : filteredTrips.length === 0 ? (
            <div className="empty-state">
              <div className="w-14 h-14 rounded-full bg-hover flex items-center justify-center mb-4">
                <MapPin size={24} className="opacity-40" />
              </div>
              <p className="font-semibold text-text-primary mb-1">No active buses</p>
              <p className="text-sm">Search a route number to start tracking.</p>
            </div>
          ) : (
            filteredTrips.map((trip) => {
              const routeName = trip.liveState?.routeName || trip.route?.name
              const busNumber = trip.bus?.busNumber || 'Bus'
              const cap = trip.liveState?.maxCapacity || trip.bus?.capacity || 50
              const occ = trip.liveState?.currentOccupancy !== undefined ? trip.liveState.currentOccupancy : trip.currentOccupancy
              const crowd = trip.liveState?.crowdLevel || 'LOW'

              return (
                <button
                  key={trip.id}
                  onClick={() => setSelectedTripId(trip.id)}
                  className={`card-interactive p-4 ${selectedTripId === trip.id ? 'border-accent bg-accent/[0.06]' : ''}`}
                >
                  <div className="flex justify-between items-start gap-3 mb-1">
                    <div className="min-w-0">
                      <span className="badge-accent mb-1.5">{busNumber}</span>
                      <h3 className="font-semibold truncate">{routeName}</h3>
                    </div>
                    {trip.liveState?.currentLat && (
                      <span className="badge-live shrink-0">
                        <span className="status-dot bg-live pulse-live" /> Live
                      </span>
                    )}
                  </div>
                  <OccupancyBar occupancy={occ} capacity={cap} crowdLevel={crowd} />
                </button>
              )
            })
          )}
        </div>
      </div>

    </div>
  )
}

export default Home
