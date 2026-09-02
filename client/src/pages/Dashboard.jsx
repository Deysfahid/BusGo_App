import { useState, useEffect, useRef } from 'react'
import { Bus, Users, Navigation, Square, Ticket, Activity } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiRequest } from '../lib/api'
import Modal from '../components/Modal'
import { connectWebSocket, disconnectWebSocket } from '../lib/websocket'

// GPS status labels, so the badge never claims more than is true.
const GPS_OFF = 'Disconnected'
const GPS_SEARCHING = 'Searching...'
const GPS_CONNECTED = 'Connected'
const GPS_POOR = 'Poor Accuracy'
const GPS_DENIED = 'Permission Denied'
const GPS_UNAVAILABLE = 'GPS Unavailable'
const GPS_UNSUPPORTED = 'Not Supported'
const GPS_INSECURE = 'Needs HTTPS'
const GPS_STALE = 'Signal Lost'
const GPS_SIM = 'Simulation'

// Above this accuracy radius (metres) the backend will move the marker but not
// advance the stop, so the UI reports it rather than showing a false "Connected".
const POOR_ACCURACY_M = 250
// No fresh fix for this long means the device has stopped reporting.
const STALE_FIX_MS = 20000
// How often to actively confirm the device can still produce a fix.
const PROBE_INTERVAL_MS = 12000

const conductorBusIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})

// Keeps the map centred on the live position without remounting the map.
function FollowBus({ lat, lon }) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lon != null) {
      map.setView([lat, lon], map.getZoom(), { animate: true })
    }
  }, [lat, lon, map])
  return null
}

export default function Dashboard() {
  const token = localStorage.getItem('busgo_token')
  const [buses, setBuses] = useState([])
  const [activeTrips, setActiveTrips] = useState([])
  const [routes, setRoutes] = useState([])
  
  const [activeBusId, setActiveBusId] = useState('')
  const [activeRouteId, setActiveRouteId] = useState('')
  const [passengerCount, setPassengerCount] = useState(1)
  const [issuing, setIssuing] = useState(false)
  const [loading, setLoading] = useState(true)
  
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [ticketToStopId, setTicketToStopId] = useState('')

  // Simulation & GPS state
  const [simulationMode, setSimulationMode] = useState(false)
  const simIntervalRef = useRef(null)
  const watchIdRef = useRef(null)
  // Last GPS fix received from the device, re-published on a heartbeat (see below).
  const lastFixRef = useRef(null)
  const gpsHeartbeatRef = useRef(null)
  const gpsProbeRef = useRef(null)

  // Real-time trip state from WebSocket
  const [liveTripState, setLiveTripState] = useState(null)
  const [gpsStatus, setGpsStatus] = useState(GPS_OFF)
  // Latest device fix {lat, lon, accuracy, at} - drives the conductor's own map.
  const [gpsFix, setGpsFix] = useState(null)

  const fetchData = async () => {
    try {
      const [busRes, tripsRes, routesRes] = await Promise.all([
        apiRequest('/api/buses', { authToken: token }),
        apiRequest('/api/trips/active', { authToken: token }),
        apiRequest('/api/routes', { authToken: token }),
      ])
      setBuses(busRes.buses || busRes.data || [])
      setActiveTrips(tripsRes.data || [])
      setRoutes(routesRes.data || [])
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) fetchData()
  }, [token])

  const activeBus = buses.find(b => String(b.id) === String(activeBusId))
  const activeTrip = activeTrips.find(t => String(t.bus?.id || t.busId) === String(activeBusId))
  const isTripStarted = !!activeTrip

  // --- WebSocket Connection ---
  useEffect(() => {
    if (isTripStarted && activeTrip) {
      connectWebSocket((stompClient) => {
        stompClient.subscribe(`/topic/bus_${activeTrip.bus.id}`, (message) => {
          if (message.body) {
            const data = JSON.parse(message.body)
            if (data.tripId) {
              setLiveTripState(data)
            }
          }
        })
      })
      return () => {
        if (simIntervalRef.current) clearInterval(simIntervalRef.current)
        if (gpsHeartbeatRef.current) clearInterval(gpsHeartbeatRef.current)
        if (gpsProbeRef.current) clearInterval(gpsProbeRef.current)
        if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
        disconnectWebSocket()
      }
    }
  }, [isTripStarted, activeTrip])

  // --- GPS Tracking & Simulation ---
  useEffect(() => {
    if (!isTripStarted || !activeTrip) return

    const publish = (lat, lon, accuracy, clientTimestamp) => {
      const client = connectWebSocket()
      const payload = {
        busId: activeTrip.bus.id,
        tripId: activeTrip.id,
        latitude: lat,
        longitude: lon,
        ...(accuracy != null ? { accuracy } : {}),
        ...(clientTimestamp != null ? { clientTimestamp } : {}),
      }
      // Simulation has no device fix of its own; mirror what it sends so the
      // conductor's map works identically in both modes.
      if (accuracy === undefined) {
        setGpsFix({ lat, lon, accuracy: null, at: Date.now() })
      }
      if (client && client.connected) {
        console.log('[GPS->WS] publish', payload)
        client.publish({
          destination: '/app/update_location',
          body: JSON.stringify(payload)
        })
      } else {
        // The heartbeat retries every second, so a drop here is transient.
        console.warn('[GPS->WS] STOMP not connected yet, dropping update', payload)
      }
    }

    if (simulationMode) {
      // Simulation Mode: drive the bus stop-to-stop, pausing (dwelling) at
      // each stop long enough for the backend geofence to fire automatically.
      // The backend advances the current stop and alights passengers on its
      // own once the bus stays within its geofence for `dwell-seconds`; the
      // conductor never presses a "next stop" button.
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (gpsHeartbeatRef.current) {
        clearInterval(gpsHeartbeatRef.current)
        gpsHeartbeatRef.current = null
      }
      if (gpsProbeRef.current) {
        clearInterval(gpsProbeRef.current)
        gpsProbeRef.current = null
      }

      // Route stops sorted by order, with valid coordinates only.
      const stops = [...(activeTrip.route?.routeStops || [])]
        .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
        .map((rs) => rs.stop)
        .filter((s) => s && s.latitude != null && s.longitude != null)

      if (stops.length < 2) {
        setGpsStatus('Sim needs 2+ stops')
        return
      }

      setGpsStatus(GPS_SIM)

      // State machine (locals, not React state, to avoid stale closures).
      let seg = 0           // current segment: stops[seg] -> stops[seg+1]
      let progress = 0      // 0..1 along the current segment
      let phase = 'move'    // 'move' | 'dwell'
      let dwellTicks = 0
      const STEP = 0.2      // ~5 movement ticks per segment
      const DWELL_TICKS = 5 // hold ~5s at each stop (> backend dwell of 3s)

      // Emit the origin position immediately so passengers see the bus start.
      publish(stops[0].latitude, stops[0].longitude)

      simIntervalRef.current = setInterval(() => {
        const from = stops[seg]
        const to = stops[seg + 1]

        if (phase === 'move') {
          progress = Math.min(1, progress + STEP)
          const lat = from.latitude + (to.latitude - from.latitude) * progress
          const lon = from.longitude + (to.longitude - from.longitude) * progress
          publish(lat, lon)
          if (progress >= 1) {
            phase = 'dwell'
            dwellTicks = 0
          }
        } else {
          // Sit exactly on the destination stop so the geofence dwell elapses.
          publish(to.latitude, to.longitude)
          dwellTicks += 1
          if (dwellTicks >= DWELL_TICKS) {
            if (seg + 1 <= stops.length - 2) {
              seg += 1
              progress = 0
              phase = 'move'
            } else {
              // Final stop reached.
              clearInterval(simIntervalRef.current)
              simIntervalRef.current = null
              setGpsStatus('Trip Complete')
            }
          }
        }
      }, 1000)

      return () => {
        if (simIntervalRef.current) {
          clearInterval(simIntervalRef.current)
          simIntervalRef.current = null
        }
      }
    } else {
      // --- Real GPS Mode: the conductor's device is the bus's position ---
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current)
        simIntervalRef.current = null
      }
      // Never run two watchers at once (e.g. after a fast sim toggle).
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (gpsHeartbeatRef.current) {
        clearInterval(gpsHeartbeatRef.current)
        gpsHeartbeatRef.current = null
      }
      if (gpsProbeRef.current) {
        clearInterval(gpsProbeRef.current)
        gpsProbeRef.current = null
      }

      lastFixRef.current = null
      setGpsFix(null)

      if (!('geolocation' in navigator)) {
        setGpsStatus(GPS_UNSUPPORTED)
        return
      }
      if (!window.isSecureContext) {
        // Browsers only expose geolocation on https or localhost.
        setGpsStatus(GPS_INSECURE)
        return
      }

      // "Searching" until a real fix arrives - never claim Connected before one.
      setGpsStatus(GPS_SEARCHING)

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords
          const fix = { lat: latitude, lon: longitude, accuracy, at: position.timestamp }
          lastFixRef.current = fix
          setGpsFix(fix)
          // A very wide accuracy circle means a Wi-Fi/cell estimate, not a real
          // satellite fix; the backend will move the marker but refuse to change
          // the current stop on it, so the status says so plainly.
          setGpsStatus(accuracy > POOR_ACCURACY_M ? GPS_POOR : GPS_CONNECTED)
          publish(latitude, longitude, accuracy, position.timestamp)
        },
        (err) => {
          console.error('[GPS] watchPosition error', err.code, err.message)
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatus(GPS_DENIED)
            lastFixRef.current = null
            setGpsFix(null)
          } else if (!lastFixRef.current) {
            // No fix yet: distinguish "still looking" from "device can't"
            setGpsStatus(err.code === err.TIMEOUT ? GPS_SEARCHING : GPS_UNAVAILABLE)
          }
          // With a previous fix in hand the heartbeat keeps publishing it; the
          // staleness check below downgrades the status if it stops refreshing.
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      )

      // Heartbeat: watchPosition only fires when the device reports a *changed*
      // fix. A stationary bus (or a mock-GPS app parked on a stop's coordinates)
      // therefore sends a single update and then goes quiet - the backend arms
      // its geofence dwell timer and never gets another ping to complete it, so
      // the stop never advances and passengers never alight. Re-publishing the
      // last known fix once a second keeps the dwell check running.
      gpsHeartbeatRef.current = setInterval(() => {
        const fix = lastFixRef.current
        if (!fix) return
        publish(fix.lat, fix.lon, fix.accuracy, fix.at)
      }, 1000)

      // Liveness probe. A stationary bus produces no watchPosition callbacks at
      // all, so "time since the last callback" cannot distinguish parked-at-a-stop
      // from GPS-is-dead. Actively asking for a fresh fix can: if the device still
      // answers, the signal is alive (and the position is refreshed); if it errors
      // or times out, it genuinely is not.
      gpsProbeRef.current = setInterval(() => {
        if (!lastFixRef.current) return
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords
            lastFixRef.current = { lat: latitude, lon: longitude, accuracy, at: Date.now() }
            setGpsFix(lastFixRef.current)
            setGpsStatus(accuracy > POOR_ACCURACY_M ? GPS_POOR : GPS_CONNECTED)
          },
          () => {
            if (Date.now() - lastFixRef.current.at > STALE_FIX_MS) {
              // Keep the last position on the map, but stop claiming it is current.
              setGpsStatus(GPS_STALE)
            }
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        )
      }, PROBE_INTERVAL_MS)

      return () => {
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
        if (gpsHeartbeatRef.current) {
          clearInterval(gpsHeartbeatRef.current)
          gpsHeartbeatRef.current = null
        }
        if (gpsProbeRef.current) {
          clearInterval(gpsProbeRef.current)
          gpsProbeRef.current = null
        }
        lastFixRef.current = null
      }
    }
  }, [isTripStarted, activeTrip, simulationMode])


  const handleStartTrip = async () => {
    if (!activeBusId) { alert('Please select a bus'); return }
    if (!activeRouteId) { alert('Please select a route'); return }
    try {
      await apiRequest('/api/trips', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify({ busId: Number(activeBusId), routeId: Number(activeRouteId) })
      })
      setSimulationMode(false)
      setLiveTripState(null)
      fetchData()
    } catch(e) { alert(e.message) }
  }

  // Stops every source of location updates. Called on END so the device stops
  // tracking immediately, rather than waiting for the effect teardown.
  const stopAllTracking = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (gpsHeartbeatRef.current) {
      clearInterval(gpsHeartbeatRef.current)
      gpsHeartbeatRef.current = null
    }
    if (gpsProbeRef.current) {
      clearInterval(gpsProbeRef.current)
      gpsProbeRef.current = null
    }
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current)
      simIntervalRef.current = null
    }
    lastFixRef.current = null
    setGpsFix(null)
    setGpsStatus(GPS_OFF)
  }

  const handleEndTrip = async () => {
    if (!activeTrip) return
    try {
      stopAllTracking()
      // The backend marks the trip completed and broadcasts that state, which
      // removes the bus from the passenger and admin live views.
      await apiRequest('/api/trips/' + activeTrip.id + '/end', { method: 'POST', authToken: token })
      setSimulationMode(false)
      setLiveTripState(null)
      fetchData()
    } catch(e) { alert(e.message) }
  }

  const handleIssueTicket = async () => {
    if (!activeTrip || !ticketToStopId) {
      alert("Please select a destination stop");
      return;
    }
    setIssuing(true)
    try {
      const fromStopId = liveTripState?.currentStopId ?? activeTrip.currentStopId
      const ticketPayload = {
        tripId: activeTrip.id,
        passengerCount: Number(passengerCount),
        // Current stop from live state, fallback to activeTrip
        fromStopId: fromStopId != null ? Number(fromStopId) : null,
        // Select values are strings; the backend matches this against stop ids.
        toStopId: Number(ticketToStopId),
      }
      console.log('[TICKET] issue', ticketPayload)
      await apiRequest('/api/tickets/issue', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify(ticketPayload),
      })
      setShowIssueModal(false)
      setPassengerCount(1)
      setTicketToStopId('')
      // Don't need to fetchData here because occupancy will update via WebSocket if needed.
    } catch (error) {
      alert(error.message)
    } finally {
      setIssuing(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-text-secondary">Loading operations data...</div>

  if (!isTripStarted) {
    return (
      <div className="max-w-md mx-auto space-y-6 animate-in fade-in">
        <div className="bg-card border border-border-subtle rounded-3xl p-6 text-center shadow-soft">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Bus size={32} className="text-accent" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Start a Trip</h2>
          <p className="text-text-secondary text-sm mb-6">Select your bus and route to begin operations.</p>
          
          <select 
            className="w-full bg-dark border border-border-subtle rounded-xl py-4 px-4 text-text-primary focus:outline-none focus:border-accent mb-3 appearance-none"
            value={activeBusId}
            onChange={(e) => setActiveBusId(e.target.value)}
          >
            <option value="" className="bg-dark text-text-primary">Select assigned bus...</option>
            {buses.map(b => (
              <option key={b.id} value={b.id} className="bg-dark text-text-primary">{b.busNumber}</option>
            ))}
          </select>

          <select 
            className="w-full bg-dark border border-border-subtle rounded-xl py-4 px-4 text-text-primary focus:outline-none focus:border-accent mb-4 appearance-none"
            value={activeRouteId}
            onChange={(e) => setActiveRouteId(e.target.value)}
          >
            <option value="" className="bg-dark text-text-primary">Select route...</option>
            {routes.map(r => (
              <option key={r.id} value={r.id} className="bg-dark text-text-primary">Route {r.name}</option>
            ))}
          </select>
          <button 
            disabled={!activeBusId || !activeRouteId}
            onClick={handleStartTrip} 
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 transition-all hover:bg-accent/90"
          >
            START TRIP
          </button>
        </div>
      </div>
    )
  }

  const busCapacity = liveTripState?.maxCapacity ?? activeBus?.capacity ?? 50
  // ?? not || : an occupancy of 0 is a real value. With || it is falsy, so the
  // display fell back to the stale figure fetched at trip start and showed the
  // old count at exactly the moment every passenger had got off.
  const currentOcc = liveTripState?.currentOccupancy ?? activeTrip.currentOccupancy ?? 0
  const percent = Math.min(100, Math.round((currentOcc / busCapacity) * 100))
  const crowdLevel = liveTripState?.crowdLevel || 'LOW'
  
  let crowdColor = 'text-crowd-low'; let crowdBg = 'bg-crowd-low'
  if (crowdLevel === 'MEDIUM') { crowdColor = 'text-crowd-mod'; crowdBg = 'bg-crowd-mod' }
  if (crowdLevel === 'HIGH') { crowdColor = 'text-crowd-high'; crowdBg = 'bg-crowd-high' }
  if (crowdLevel === 'FULL') { crowdColor = 'text-crowd-full'; crowdBg = 'bg-crowd-full' }

  const routeStops = activeTrip.route?.routeStops || []
  const currentStopName = liveTripState?.currentStopName || 'Not reached yet'
  const nextStopName = liveTripState?.nextStopName || (liveTripState ? 'End of route' : 'Detecting...')

  // Green only when a real fix is flowing; amber for degraded but usable.
  const gpsTone =
    gpsStatus === GPS_CONNECTED || gpsStatus === GPS_SIM
      ? 'bg-green-500/10 text-green-500'
      : gpsStatus === GPS_SEARCHING || gpsStatus === GPS_POOR || gpsStatus === GPS_STALE
        ? 'bg-amber-500/10 text-amber-400'
        : 'bg-red-500/10 text-red-400'

  return (
    <div className="max-w-md mx-auto space-y-4 animate-in fade-in pb-12 relative">
      {/* Simulation Toggle and GPS Status */}
      <div className="flex flex-col gap-3">
        {/* GPS Status Indicator */}
        <div className={`flex flex-col items-center p-3 rounded-2xl font-bold tracking-wide transition-colors ${gpsTone}`}>
           <div className="flex items-center">
             <Navigation size={18} className="mr-2" />
             GPS ● {gpsStatus}
           </div>
           {gpsFix && (
             <div className="mt-1 text-xs font-normal opacity-80">
               {gpsFix.lat.toFixed(5)}, {gpsFix.lon.toFixed(5)}
               {gpsFix.accuracy != null && ` · ±${Math.round(gpsFix.accuracy)}m`}
             </div>
           )}
           {gpsStatus === GPS_DENIED && (
             <div className="mt-1 text-xs font-normal opacity-80">
               Allow location for this site in your browser settings, then reload.
             </div>
           )}
           {gpsStatus === GPS_INSECURE && (
             <div className="mt-1 text-xs font-normal opacity-80">
               Browsers only give GPS over https:// or localhost.
             </div>
           )}
           {gpsStatus === GPS_POOR && (
             <div className="mt-1 text-xs font-normal opacity-80">
               Position shown, but too coarse to confirm a stop arrival.
             </div>
           )}
        </div>

        {/* Conductor's own live map */}
        {gpsFix && (
          <div className="h-56 w-full rounded-2xl overflow-hidden border border-border-subtle">
            <MapContainer
              center={[gpsFix.lat, gpsFix.lon]}
              zoom={16}
              style={{ height: '100%', width: '100%', zIndex: 1 }}
            >
              <FollowBus lat={gpsFix.lat} lon={gpsFix.lon} />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
              {gpsFix.accuracy != null && (
                <Circle
                  center={[gpsFix.lat, gpsFix.lon]}
                  radius={gpsFix.accuracy}
                  pathOptions={{ color: '#3b82f6', fillOpacity: 0.08, weight: 1 }}
                />
              )}
              <Marker position={[gpsFix.lat, gpsFix.lon]} icon={conductorBusIcon} />
            </MapContainer>
          </div>
        )}

        <div className="flex items-center justify-between bg-dark border border-border-subtle p-3 rounded-2xl shadow-soft">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Activity size={16} className={simulationMode ? 'text-green-400' : ''}/> 
            Simulation Mode
          </div>
          <button 
            onClick={() => setSimulationMode(!simulationMode)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${simulationMode ? 'bg-green-500' : 'bg-border-subtle'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${simulationMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Header Info */}
      <div className="bg-card border border-border-subtle rounded-3xl p-5 shadow-soft flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="inline-block px-3 py-1 bg-hover rounded-lg text-sm font-bold tracking-wider mb-2">
              {activeBus?.busNumber}
            </span>
            <h2 className="font-semibold text-lg">{activeTrip.route?.name}</h2>
          </div>
          <button onClick={handleEndTrip} className="flex items-center gap-2 text-xs font-semibold text-red-400 bg-red-400/10 px-3 py-2 rounded-lg hover:bg-red-400/20 transition-colors">
            <Square size={14} /> END
          </button>
        </div>

        {/* Live GPS Stops Info */}
        <div className="bg-dark rounded-2xl p-4 border border-border-subtle mb-4">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center mt-1">
                <div className="w-3 h-3 rounded-full bg-accent"></div>
                <div className="w-0.5 h-8 bg-border-subtle my-1"></div>
                <div className="w-3 h-3 rounded-full border-2 border-accent bg-dark"></div>
              </div>
              <div className="flex-1">
                <div className="mb-4">
                  <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Current Stop</p>
                  <p className="font-medium">{currentStopName}</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Next Stop (Auto-detecting via GPS)</p>
                  <p className="font-medium text-accent">{nextStopName}</p>
                </div>
              </div>
            </div>
        </div>

        {/* Occupancy Progress */}
        <div className="mt-2 bg-dark p-4 rounded-2xl border border-border-subtle">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-text-secondary flex items-center gap-2"><Users size={16}/> Live Occupancy</span>
            <span className={`font-bold ${crowdColor} text-xl`}>{currentOcc} <span className="text-text-secondary text-sm font-normal">/ {busCapacity}</span></span>
          </div>
          <div className="h-3 w-full bg-card rounded-full overflow-hidden border border-border-subtle">
            <div className={`h-full ${crowdBg} transition-all duration-500`} style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      {/* Primary Action: Issue Ticket */}
      <button 
        onClick={() => setShowIssueModal(true)}
        className="w-full bg-accent hover:bg-accent/90 text-white p-5 rounded-3xl shadow-soft flex items-center justify-between transition-all active:scale-[0.98]"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <Ticket size={24} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-lg">Issue Ticket</h3>
            <p className="text-white/80 text-sm">Cash payment only</p>
          </div>
        </div>
        <div className="bg-white/20 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold">+</div>
      </button>

      {/* Issue Ticket Modal */}
      <Modal isOpen={showIssueModal} onClose={() => setShowIssueModal(false)} title="Issue Ticket">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Destination Stop</label>
            <select
              className="w-full bg-dark border border-border-subtle rounded-xl py-3 px-4 text-text-primary focus:outline-none focus:border-accent appearance-none"
              value={ticketToStopId}
              onChange={(e) => setTicketToStopId(e.target.value)}
            >
              <option value="">Select destination...</option>
              {routeStops.map(rs => (
                <option key={rs.stop.id} value={rs.stop.id}>{rs.stop.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Number of Passengers</label>
            <div className="flex items-center gap-4 bg-dark rounded-xl border border-border-subtle p-2">
              <button 
                type="button"
                onClick={() => setPassengerCount(Math.max(1, passengerCount - 1))}
                className="w-12 h-12 rounded-lg bg-hover flex items-center justify-center text-xl font-bold hover:bg-white/10"
              >-</button>
              <div className="flex-1 text-center text-2xl font-bold">{passengerCount}</div>
              <button 
                type="button"
                onClick={() => setPassengerCount(passengerCount + 1)}
                className="w-12 h-12 rounded-lg bg-hover flex items-center justify-center text-xl font-bold hover:bg-white/10"
              >+</button>
            </div>
          </div>
          <div className="pt-2">
            <button 
              disabled={!ticketToStopId || issuing}
              onClick={handleIssueTicket}
              className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 hover:bg-accent/90 transition-colors"
            >
              {issuing ? 'ISSUING...' : 'PRINT TICKET'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
