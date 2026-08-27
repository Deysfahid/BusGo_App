import { useState, useEffect, useMemo } from 'react'
import { apiRequest } from '../lib/api'
import { Search, MapPin, Clock, Navigation, Bus } from 'lucide-react'
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

function Home() {
  const [activeTrips, setActiveTrips] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTripId, setSelectedTripId] = useState(null)
  
  // Real-time WebSocket connection
  useEffect(() => {
    const fetchActiveTrips = async () => {
      try {
        const res = await apiRequest('/api/trips/active')
        setActiveTrips(res.data || [])
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
        }
      })
    })

    return () => {
      disconnectWebSocket()
    }
  }, [])

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

  const getCrowdInfo = (crowdLevel) => {
    switch(crowdLevel) {
      case 'LOW': return { label: 'LOW CROWD', color: 'text-crowd-low', bg: 'bg-crowd-low' }
      case 'MEDIUM': return { label: 'MODERATE CROWD', color: 'text-crowd-mod', bg: 'bg-crowd-mod' }
      case 'HIGH': return { label: 'HIGH CROWD', color: 'text-crowd-high', bg: 'bg-crowd-high' }
      case 'FULL': return { label: 'FULL', color: 'text-crowd-full', bg: 'bg-crowd-full' }
      default: return { label: 'LOW CROWD', color: 'text-crowd-low', bg: 'bg-crowd-low' }
    }
  }

  const renderProgressBar = (occupancy, capacity, crowdLevel) => {
    const percent = Math.min(100, Math.round((occupancy / capacity) * 100))
    const crowd = getCrowdInfo(crowdLevel)
    return (
      <div className="mt-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-border-subtle">
          <div className={`h-full rounded-full ${crowd.bg} transition-all duration-500`} style={{ width: `${percent}%` }} />
        </div>
        <div className="flex justify-between items-center mt-2 text-xs">
          <span className="text-text-secondary">{occupancy} / {capacity} passengers</span>
          <span className={`font-bold ${crowd.color}`}>{percent}%   {crowd.label}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)]">
      {/* Left Panel: Search & Bus List */}
      <div className="w-full lg:w-1/3 flex flex-col border-r border-border-subtle bg-dark h-full shrink-0">
        <div className="p-6 pb-4">
          <h1 className="text-2xl font-bold mb-4">Where do you want to go?</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={20} />
            <input
              type="text"
              placeholder="Search route or bus number..."
              className="w-full bg-card border border-border-subtle rounded-xl py-3 pl-10 pr-4 text-text-primary focus:outline-none focus:border-accent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {filteredTrips.length === 0 ? (
            <div className="text-center p-8 text-text-secondary">
              <MapPin className="mx-auto mb-3 opacity-50" size={32} />
              <p>No active buses found.</p>
            </div>
          ) : (
            filteredTrips.map((trip) => {
              const routeName = trip.liveState?.routeName || trip.route?.name
              const busNumber = trip.bus?.busNumber || 'Bus'
              const cap = trip.liveState?.maxCapacity || trip.bus?.capacity || 50
              const occ = trip.liveState?.currentOccupancy !== undefined ? trip.liveState.currentOccupancy : trip.currentOccupancy
              const crowd = trip.liveState?.crowdLevel || 'LOW'
              
              return (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTripId(trip.id)}
                  className={`bg-card p-5 rounded-2xl cursor-pointer transition-all border ${selectedTripId === trip.id ? 'border-accent shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-border-subtle hover:border-text-secondary/30'}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="inline-block px-2 py-1 bg-accent/20 text-accent text-xs font-bold rounded mb-1">{busNumber}</span>
                      <h3 className="font-bold text-lg">Route {routeName}</h3>
                    </div>
                  </div>
                  {renderProgressBar(occ, cap, crowd)}
                  {trip.liveState?.currentLat && (
                    <div className="mt-3 text-xs text-text-secondary flex gap-2">
                       <Navigation size={12} className="text-accent"/> GPS Live Map Available
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Right Panel: Live Map & Details */}
      <div className="w-full lg:w-2/3 h-full flex flex-col bg-dark relative">
        {selectedTrip ? (
          <div className="flex flex-col h-full">
            {/* Live Map Area (Top 50%) */}
            <div className="h-1/2 w-full relative border-b border-border-subtle bg-dark">
               {selectedTrip.liveState?.currentLat && selectedTrip.liveState?.currentLon ? (
                  <MapContainer
                    center={[selectedTrip.liveState.currentLat, selectedTrip.liveState.currentLon]}
                    zoom={15}
                    style={{ height: "100%", width: "100%", zIndex: 1 }}
                    key={selectedTrip.id}
                  >
                    <RecenterMap lat={selectedTrip.liveState.currentLat} lon={selectedTrip.liveState.currentLon} />
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    />
                    <Marker 
                      position={[selectedTrip.liveState.currentLat, selectedTrip.liveState.currentLon]}
                      icon={busIcon}
                    >
                      <Popup className="bg-dark text-text-primary border-none rounded-xl">
                        <div className="font-bold">{selectedTrip.bus?.busNumber}</div>
                        <div className="text-sm">Route {selectedTrip.route?.name}</div>
                      </Popup>
                    </Marker>
                  </MapContainer>
               ) : (
                  <div className="h-full flex items-center justify-center text-text-secondary">
                     Waiting for GPS signal...
                  </div>
               )}
            </div>

            {/* Details Area (Bottom 50%) */}
            <div className="h-1/2 p-6 overflow-y-auto bg-card">
              {/* Live Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-dark p-4 rounded-2xl border border-border-subtle">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Status</p>
                  <p className="font-bold text-green-400 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    Live
                  </p>
                </div>
                <div className="bg-dark p-4 rounded-2xl border border-border-subtle">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Available Seats</p>
                  <p className="font-bold text-xl">{selectedTrip.liveState?.availableSeats !== undefined ? selectedTrip.liveState.availableSeats : (selectedTrip.bus?.capacity - selectedTrip.currentOccupancy)}</p>
                </div>
                <div className="bg-dark p-4 rounded-2xl border border-border-subtle">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Crowd Pred.</p>
                  <p className="font-bold text-xl">{selectedTrip.liveState?.crowdLevel || 'LOW'}</p>
                </div>
                <div className="bg-dark p-4 rounded-2xl border border-border-subtle">
                  <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Next Stop</p>
                  <p className="font-bold text-accent">{selectedTrip.liveState?.nextStopName || 'Detecting...'}</p>
                </div>
              </div>

              {/* ETA Timeline */}
              <div className="bg-dark rounded-3xl p-6 border border-border-subtle mb-4">
                <h3 className="font-bold text-xl mb-4 flex items-center gap-2"><Clock size={20} className="text-accent" /> Live ETA Timeline</h3>
                
                {!selectedTrip.liveState?.remainingStopsEta ? (
                  <div className="text-text-secondary p-4 text-center border border-dashed border-border-subtle rounded-xl">
                    Waiting for GPS sync from conductor...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedTrip.liveState.remainingStopsEta.map((eta) => (
                      <div key={eta.stopId} className="flex items-center justify-between bg-card p-3 rounded-xl border border-border-subtle">
                        <div className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                              <MapPin size={16} className="text-accent" />
                           </div>
                           <h4 className="font-bold">{eta.stopName}</h4>
                        </div>
                        <span className={`px-3 py-1 rounded-lg text-sm font-bold ${eta.estimatedMinutes <= 5 ? 'bg-green-500/20 text-green-400' : 'bg-hover text-text-secondary'}`}>
                          {eta.estimatedMinutes} min
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-text-secondary p-8">
            <div className="w-24 h-24 rounded-full bg-dark flex items-center justify-center mb-6 shadow-soft">
              <Bus size={48} className="opacity-20" />
            </div>
            <h2 className="text-2xl font-bold text-text-primary mb-2">Select a Bus</h2>
            <p className="text-center max-w-md">Click on any active route from the left panel to see live location, ETA, and crowd predictions.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Home
