import { useState, useEffect, useRef } from 'react'
import { Bus, Users, Navigation, Square, Ticket, Activity } from 'lucide-react'
import { apiRequest } from '../lib/api'
import Modal from '../components/Modal'
import { connectWebSocket, disconnectWebSocket } from '../lib/websocket'

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
  
  // Real-time trip state from WebSocket
  const [liveTripState, setLiveTripState] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('Disconnected')

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
        if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
        disconnectWebSocket()
      }
    }
  }, [isTripStarted, activeTrip])

  // --- GPS Tracking & Simulation ---
  useEffect(() => {
    if (!isTripStarted || !activeTrip) return

    const publish = (lat, lon) => {
      const client = connectWebSocket()
      if (client && client.connected) {
        client.publish({
          destination: '/app/update_location',
          body: JSON.stringify({
            busId: activeTrip.bus.id,
            tripId: activeTrip.id,
            latitude: lat,
            longitude: lon
          })
        })
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

      // Route stops sorted by order, with valid coordinates only.
      const stops = [...(activeTrip.route?.routeStops || [])]
        .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
        .map((rs) => rs.stop)
        .filter((s) => s && s.latitude != null && s.longitude != null)

      if (stops.length < 2) {
        setGpsStatus('Sim needs 2+ stops')
        return
      }

      setGpsStatus('Connected')

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
      // Real GPS Mode
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current)
        simIntervalRef.current = null
      }

      setGpsStatus('Connecting...')

      if ('geolocation' in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            setGpsStatus('Connected')
            publish(position.coords.latitude, position.coords.longitude)
          },
          (err) => {
            console.error(err)
            setGpsStatus('GPS Unavailable')
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 5000 }
        )
      } else {
        setGpsStatus('GPS Unavailable')
      }
      return () => {
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
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

  const handleEndTrip = async () => {
    if (!activeTrip) return
    try {
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
      await apiRequest('/api/tickets/issue', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify({
          tripId: activeTrip.id,
          passengerCount: Number(passengerCount),
          // Current stop from live state, fallback to activeTrip
          fromStopId: liveTripState?.currentStopId || activeTrip.currentStopId,
          toStopId: ticketToStopId
        }),
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

  const busCapacity = liveTripState?.maxCapacity || activeBus?.capacity || 50
  const currentOcc = liveTripState?.currentOccupancy || activeTrip.currentOccupancy || 0
  const percent = Math.min(100, Math.round((currentOcc / busCapacity) * 100))
  const crowdLevel = liveTripState?.crowdLevel || 'LOW'
  
  let crowdColor = 'text-crowd-low'; let crowdBg = 'bg-crowd-low'
  if (crowdLevel === 'MEDIUM') { crowdColor = 'text-crowd-mod'; crowdBg = 'bg-crowd-mod' }
  if (crowdLevel === 'HIGH') { crowdColor = 'text-crowd-high'; crowdBg = 'bg-crowd-high' }
  if (crowdLevel === 'FULL') { crowdColor = 'text-crowd-full'; crowdBg = 'bg-crowd-full' }

  const routeStops = activeTrip.route?.routeStops || []
  const currentStopName = liveTripState?.currentStopName || 'Unknown'
  const nextStopName = liveTripState?.nextStopName || 'Unknown'

  return (
    <div className="max-w-md mx-auto space-y-4 animate-in fade-in pb-12 relative">
      {/* Simulation Toggle and GPS Status */}
      <div className="flex flex-col gap-3">
        {/* GPS Status Indicator */}
        <div className={`flex items-center justify-center p-3 rounded-2xl font-bold tracking-wide transition-colors ${gpsStatus === 'Connected' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400'}`}>
           <Navigation size={18} className="mr-2" /> 
           GPS ● {gpsStatus}
        </div>
        
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
