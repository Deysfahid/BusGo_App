import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { connectWebSocket, disconnectWebSocket } from '../lib/websocket'
import { Bus, Route as RouteIcon, MapPin, Users, Ticket, TrendingUp, DollarSign, Plus, Search, Trash2, Brain, Clock, Activity } from 'lucide-react'

export default function AdminDashboard() {
  const location = useLocation()
  
  // Extract tab from pathname
  const getTab = () => {
    const path = location.pathname
    if (path.includes('/buses')) return 'buses'
    if (path.includes('/routes')) return 'routes'
    if (path.includes('/stops')) return 'stops'
    if (path.includes('/conductors')) return 'conductors'
    if (path.includes('/analytics')) return 'analytics'
    if (path.includes('/predictions')) return 'predictions'
    return 'overview'
  }

  const activeTab = getTab()

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />
      case 'buses': return <BusesTab />
      case 'routes': return <RoutesTab />
      case 'stops': return <StopsTab />
      case 'conductors': return <ConductorsTab />
      case 'analytics': return <AnalyticsTab />
      case 'predictions': return <PredictionsTab />
      default: return <OverviewTab />
    }
  }

  return (
    <div className="p-5 sm:p-7 max-w-[1400px] mx-auto">
      {renderTabContent()}
    </div>
  )
}

function OverviewTab() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [liveCount, setLiveCount] = useState(null)

  useEffect(() => {
    apiRequest('/api/admin/stats')
      .then(res => setStats(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-text-secondary">Loading metrics...</div>
  if (!stats) return <div className="text-red-400">Failed to load overview data.</div>

  const cards = [
    { title: 'Total Buses', value: stats.totalBuses, icon: Bus, color: 'text-accent', bg: 'bg-accent/10' },
    // Live count wins once the fleet panel below has its data, so this card
    // does not go stale while trips start and end.
    { title: 'Active Trips', value: liveCount ?? stats.activeTrips, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { title: 'Routes', value: stats.totalRoutes, icon: RouteIcon, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { title: 'Assign Conductors', value: stats.totalConductors, icon: Users, color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { title: 'Total Tickets', value: stats.totalTickets, icon: Ticket, color: 'text-pink-400', bg: 'bg-pink-400/10' },
    { title: 'Avg Occupancy', value: `${stats.averageOccupancy}%`, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { title: "Today's Revenue", value: `₹${stats.todayRevenue}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  ]

  return (
    <div>
      <h2 className="page-title mb-6">Dashboard Overview</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.title} className="card p-5 hover:border-border-strong transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${card.bg}`}>
                  <Icon size={24} className={card.color} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{card.title}</h3>
                <p className="text-3xl font-bold">{card.value}</p>
              </div>
            </div>
          )
        })}
      </div>

      <LiveFleetPanel onCountChange={setLiveCount} />
    </div>
  )
}

/**
 * Live fleet view. Subscribes to the same `/topic/bus-updates` broadcast the
 * passenger view uses, so the admin sees stop progression, occupancy and crowd
 * change as buses move, without reloading the page.
 */
function LiveFleetPanel({ onCountChange }) {
  const [fleet, setFleet] = useState({})   // tripId -> { busId, busNumber, routeName, live }
  const [now, setNow] = useState(() => Date.now())
  const [connected, setConnected] = useState(false)

  // Ticks the "last update" ages so a bus that stops reporting is obvious.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    let lastRefetch = 0

    // Seed from REST so buses already running appear before their next ping.
    const loadActive = async () => {
      try {
        const res = await apiRequest('/api/trips/active')
        if (cancelled) return
        setFleet(prev => {
          const next = { ...prev }
          for (const t of res.data || []) {
            next[t.id] = {
              busId: t.bus?.id,
              busNumber: t.bus?.busNumber,
              routeName: t.route?.name,
              capacity: t.bus?.capacity,
              live: prev[t.id]?.live ?? null,
            }
          }
          return next
        })
      } catch (err) {
        console.error(err)
      }
    }
    loadActive()

    connectWebSocket((stompClient) => {
      if (cancelled) return
      setConnected(true)
      stompClient.subscribe('/topic/bus-updates', (msg) => {
        if (!msg.body) return
        const state = JSON.parse(msg.body)
        if (!state.tripId) return

        setFleet(prev => {
          if (state.status === 'completed') {
            const next = { ...prev }
            delete next[state.tripId]
            return next
          }
          const existing = prev[state.tripId]
          // A trip we have never seen: pull its bus/route details once.
          if (!existing && Date.now() - lastRefetch > 5000) {
            lastRefetch = Date.now()
            loadActive()
          }
          return {
            ...prev,
            [state.tripId]: {
              busId: state.busId,
              busNumber: existing?.busNumber,
              routeName: state.routeName || existing?.routeName,
              capacity: state.maxCapacity || existing?.capacity,
              live: state,
            },
          }
        })
      })
    })

    return () => {
      cancelled = true
      disconnectWebSocket()
    }
  }, [])

  const entries = Object.entries(fleet)

  useEffect(() => {
    onCountChange?.(entries.length)
  }, [entries.length, onCountChange])

  const crowdColor = (level) => {
    switch (level) {
      case 'MEDIUM': return 'text-crowd-mod'
      case 'HIGH': return 'text-crowd-high'
      case 'FULL': return 'text-crowd-full'
      default: return 'text-crowd-low'
    }
  }
  const crowdBg = (level) => {
    switch (level) {
      case 'MEDIUM': return 'bg-crowd-mod'
      case 'HIGH': return 'bg-crowd-high'
      case 'FULL': return 'bg-crowd-full'
      default: return 'bg-crowd-low'
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-xl font-bold">Live Fleet</h3>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${connected ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'Live' : 'Connecting...'}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-2xl p-8 text-center text-text-secondary">
          No trips are running right now. Buses appear here as soon as a conductor starts a trip.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {entries.map(([tripId, item]) => {
            const live = item.live
            const cap = item.capacity || 50
            const occ = live?.currentOccupancy ?? 0
            const percent = Math.min(100, Math.round((occ / cap) * 100))
            const level = live?.crowdLevel || 'LOW'
            // Clamped: the server stamps the time, so a small clock skew between
            // machines can otherwise render a negative age.
            const ageSec = live?.timestamp ? Math.max(0, Math.round((now - live.timestamp) / 1000)) : null
            const stale = ageSec != null && ageSec > 15

            return (
              <div key={tripId} className="card-pad">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="inline-block px-2 py-1 bg-accent/20 text-accent text-xs font-bold rounded mb-1">
                      {item.busNumber || `Bus #${item.busId}`}
                    </span>
                    <h4 className="font-semibold">{item.routeName || 'Unknown route'}</h4>
                  </div>
                  <span className={`text-xs font-medium ${stale ? 'text-amber-400' : 'text-text-secondary'}`}>
                    {ageSec == null ? 'awaiting GPS' : stale ? `no GPS for ${ageSec}s` : `${ageSec}s ago`}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm mb-4">
                  <MapPin size={14} className="text-text-secondary shrink-0" />
                  <span className="font-medium">{live?.currentStopName || '—'}</span>
                  <span className="text-text-secondary">→</span>
                  <span className="text-accent font-medium">{live?.nextStopName || 'end of route'}</span>
                </div>

                <div className="flex justify-between text-sm mb-2">
                  <span className="text-text-secondary flex items-center gap-2"><Users size={14} /> Occupancy</span>
                  <span className={`font-bold ${crowdColor(level)}`}>
                    {occ} <span className="text-text-secondary font-normal">/ {cap}</span>
                    <span className="text-text-secondary font-normal"> · {live?.availableSeats ?? cap - occ} free</span>
                  </span>
                </div>
                <div className="h-2 w-full bg-dark rounded-full overflow-hidden border border-border-subtle">
                  <div className={`h-full ${crowdBg(level)} transition-all duration-500`} style={{ width: `${percent}%` }} />
                </div>

                <div className="flex items-center justify-between mt-3 text-xs">
                  <span className={`font-semibold ${crowdColor(level)}`}>{level} CROWD</span>
                  {live?.remainingStopsEta?.length > 0 && (
                    <span className="text-text-secondary flex items-center gap-1">
                      <Clock size={12} />
                      {live.remainingStopsEta[0].stopName} in {live.remainingStopsEta[0].estimatedMinutes} min
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import Modal from '../components/Modal'

function BusesTab() {
  const [buses, setBuses] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({ busNumber: '', routeName: '', capacity: 50, stops: '' })

  const fetchBuses = () => apiRequest('/api/admin/buses').then(res => setBuses(res.data)).catch(console.error)

  useEffect(() => {
    fetchBuses()
  }, [])

  const handleDelete = async (busId) => {
    if (!confirm('Delete this bus? This cannot be undone.')) return
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest(`/api/admin/buses/${busId}`, { method: 'DELETE', authToken: token })
      fetchBuses()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest('/api/admin/buses', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify({
          busNumber: formData.busNumber,
          routeName: formData.routeName,
          capacity: Number(formData.capacity),
          stops: formData.stops.split(',').map(s => s.trim()).filter(Boolean)
        })
      })
      setIsModalOpen(false)
      setFormData({ busNumber: '', routeName: '', capacity: 50, stops: '' })
      fetchBuses()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="page-title">Bus Fleet</h2>
        <button onClick={() => setIsModalOpen(true)} className="btn-primary btn-sm">
          <Plus size={18} /> Add Bus
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border-subtle flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
            <input type="text" placeholder="Search buses..." className="w-full bg-dark border border-border-subtle rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-accent" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-hover/40 text-text-secondary border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Bus Number</th>
                <th className="px-6 py-4 font-medium">Route</th>
                <th className="px-6 py-4 font-medium">Capacity</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {buses.map(bus => (
                <tr key={bus.id} className="hover:bg-hover/30 transition-colors">
                  <td className="px-6 py-4 font-medium">{bus.plateNumber || bus.busNumber}</td>
                  <td className="px-6 py-4 text-text-secondary">{bus.routeName}</td>
                  <td className="px-6 py-4 text-text-secondary">{bus.capacity} seats</td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => handleDelete(bus.id)} className="text-text-secondary hover:text-red-400 p-1 ml-2"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {buses.length === 0 && (
                <tr><td colSpan="4" className="px-6 py-8 text-center text-text-secondary">No buses found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Bus">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Bus Number</label>
            <input type="text" required value={formData.busNumber} onChange={e => setFormData({...formData, busNumber: e.target.value})} className="input" placeholder="KA-01-F-1234" />
          </div>
          <div>
            <label className="label">Route Name</label>
            <input type="text" required value={formData.routeName} onChange={e => setFormData({...formData, routeName: e.target.value})} className="input" placeholder="Majestic -> ITPL" />
          </div>
          <div>
            <label className="label">Capacity</label>
            <input type="number" required value={formData.capacity} onChange={e => setFormData({...formData, capacity: e.target.value})} className="input" />
          </div>
          <div>
            <label className="label">Stops (Comma separated)</label>
            <input type="text" value={formData.stops} onChange={e => setFormData({...formData, stops: e.target.value})} className="input" placeholder="Stop1, Stop2, Stop3" />
          </div>
          <button type="submit" className="btn-primary btn-block mt-6">
            Save Bus
          </button>
        </form>
      </Modal>
    </div>
  )
}

function RoutesTab() {
  const [routes, setRoutes] = useState([])
  const [stops, setStops] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [expandedRoute, setExpandedRoute] = useState(null)
  const [addStopId, setAddStopId] = useState('')
  const [formData, setFormData] = useState({ name: '' })
  const [draggedId, setDraggedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  
  const token = localStorage.getItem('busgo_token')

  const fetchRoutes = () => apiRequest('/api/admin/routes', { authToken: token }).then(res => setRoutes(res.data || [])).catch(console.error)
  const fetchStops = () => apiRequest('/api/admin/stops', { authToken: token }).then(res => setStops(res.data || [])).catch(console.error)

  useEffect(() => { fetchRoutes(); fetchStops() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await apiRequest('/api/admin/routes', { method: 'POST', authToken: token, body: JSON.stringify({ name: formData.name }) })
      setIsModalOpen(false); setFormData({ name: '' }); fetchRoutes()
    } catch (err) { alert(err.message) }
  }

  const handleAddStop = async (routeId) => {
    if (!addStopId) return
    try {
      await apiRequest(`/api/admin/routes/${routeId}/stops`, { method: 'POST', authToken: token, body: JSON.stringify({ stopId: Number(addStopId) }) })
      setAddStopId(''); fetchRoutes()
    } catch (err) { alert(err.message) }
  }

  const handleRemoveStop = async (routeId, stopId) => {
    try {
      await apiRequest(`/api/admin/routes/${routeId}/stops/${stopId}`, { method: 'DELETE', authToken: token })
      setDeleteConfirm(null); fetchRoutes()
    } catch (err) { alert(err.message) }
  }

  const handleDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move' }
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const handleDrop = async (e, routeId, targetId) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return }
    const route = routes.find(r => r.id === routeId)
    const sorted = (route?.routeStops || []).slice().sort((a,b) => a.stopOrder - b.stopOrder)
    const fromIdx = sorted.findIndex(rs => rs.id === draggedId)
    const toIdx = sorted.findIndex(rs => rs.id === targetId)
    if (fromIdx < 0 || toIdx < 0) { setDraggedId(null); return }
    // Call reorder multiple times to move from fromIdx to toIdx
    const dir = fromIdx > toIdx ? 1 : -1
    let current = fromIdx
    while (current !== toIdx) {
      const rsId = sorted[current].id
      await apiRequest(`/api/admin/routes/${routeId}/stops/reorder`, { method: 'POST', authToken: token, body: JSON.stringify({ routeStopId: rsId, direction: dir }) })
      const swapWith = current + (dir === 1 ? -1 : 1)
      const tmp = sorted[current]; sorted[current] = sorted[swapWith]; sorted[swapWith] = tmp
      current += (dir === 1 ? -1 : 1)
    }
    setDraggedId(null); fetchRoutes()
  }

  if (expandedRoute) {
    const route = routes.find(r => r.id === expandedRoute)
    const sortedStops = (route?.routeStops || []).slice().sort((a, b) => a.stopOrder - b.stopOrder)
    const availableStops = stops.filter(s => !sortedStops.some(rs => rs.stop?.id === s.id))
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => { setExpandedRoute(null); setAddStopId(''); setDeleteConfirm(null) }} className="flex items-center gap-2 text-text-secondary hover:text-text-primary bg-hover px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            &larr; Back to Routes
          </button>
          <h2 className="page-title">Route {route?.name} &mdash; Stop Order</h2>
        </div>
        <p className="text-text-secondary text-sm mb-3">Drag rows to reorder &bull; Click trash to delete</p>
        <div className="card overflow-hidden mb-4">
          {sortedStops.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">No stops yet. Add one below.</div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {sortedStops.map((rs, i) => (
                <div
                  key={rs.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, rs.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, route.id, rs.id)}
                  className={`flex items-center gap-4 px-5 py-4 transition-colors cursor-grab active:cursor-grabbing ${draggedId === rs.id ? 'opacity-40 bg-accent/5' : 'hover:bg-hover/30'}`}
                >
                  <span className="text-text-secondary select-none text-lg pr-1">&#8597;</span>
                  <span className="w-7 h-7 rounded-full bg-accent/20 text-accent font-bold text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 font-medium select-none">{rs.stop?.name}</span>
                  {deleteConfirm === rs.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary">Delete?</span>
                      <button onClick={() => handleRemoveStop(route.id, rs.stop?.id)} className="text-xs bg-red-500 text-white px-2 py-1 rounded-md font-bold">Yes</button>
                      <button onClick={() => setDeleteConfirm(null)} className="text-xs bg-hover text-text-secondary px-2 py-1 rounded-md">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(rs.id)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card-pad">
          <h3 className="font-semibold mb-3 text-text-secondary text-sm uppercase tracking-wider">Add Stop to Route</h3>
          <div className="flex gap-2">
            <select className="flex-1 bg-dark border border-border-subtle rounded-lg py-2.5 px-3 text-text-primary focus:border-accent outline-none" value={addStopId} onChange={e => setAddStopId(e.target.value)}>
              <option value="">Select a stop to add...</option>
              {availableStops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => handleAddStop(route.id)} disabled={!addStopId} className="bg-accent text-white px-5 py-2.5 rounded-lg font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">Add</button>
          </div>
          {availableStops.length === 0 && <p className="text-xs text-text-secondary mt-2">All stops are on this route. Create new stops in the Stops tab.</p>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="page-title">Routes</h2>
        <button onClick={() => setIsModalOpen(true)} className="btn-primary btn-sm">
          <Plus size={18} /> Add Route
        </button>
      </div>
      <div className="card overflow-hidden">
        {routes.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No routes found. Create your first route.</div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {routes.map(r => (
              <div key={r.id} className="flex items-center justify-between px-6 py-4 hover:bg-hover/30 transition-colors cursor-pointer" onClick={() => { setExpandedRoute(r.id); setDeleteConfirm(null) }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-400/10 text-purple-400 flex items-center justify-center font-bold text-sm">{r.name}</div>
                  <div>
                    <p className="font-medium">Route {r.name}</p>
                    <p className="text-xs text-text-secondary">{(r.routeStops || []).length} stops</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-text-secondary">
                  <span className="text-xs hidden md:block">{(r.routeStops || []).slice().sort((a,b)=>a.stopOrder-b.stopOrder).map(rs=>rs.stop?.name).join(' > ') || 'No stops'}</span>
                  <span className="text-xl">&rsaquo;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Route">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Route Name / Number</label>
            <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="input" placeholder="e.g. 285 or Silk Board - Indiranagar" />
          </div>
          <button type="submit" className="btn-primary btn-block mt-6">Save Route</button>
        </form>
      </Modal>
    </div>
  )
}
function StopsTab() {
  const [stops, setStops] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({ name: '', latitude: '', longitude: '' })
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')

  // --- OpenStreetMap import (adds stop reference data; unrelated to live tracking) ---
  const [osmOpen, setOsmOpen] = useState(false)
  const [osmCentre, setOsmCentre] = useState({ lat: '', lon: '' })
  const [osmRadius, setOsmRadius] = useState(2000)
  const [osmFilter, setOsmFilter] = useState('')
  const [osmResults, setOsmResults] = useState(null)
  const [osmChosen, setOsmChosen] = useState({})
  const [osmBusy, setOsmBusy] = useState(false)
  const [osmError, setOsmError] = useState('')

  const osmUseMyLocation = () => {
    setOsmError('')
    if (!('geolocation' in navigator)) { setOsmError('This browser has no location support.'); return }
    setOsmBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOsmCentre({ lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) })
        setOsmBusy(false)
      },
      () => { setOsmError('Could not get a location fix. Location needs https (or localhost).'); setOsmBusy(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const osmSearch = async () => {
    setOsmError(''); setOsmResults(null); setOsmChosen({})
    if (!osmCentre.lat || !osmCentre.lon) { setOsmError('Set a centre point first.'); return }
    setOsmBusy(true)
    try {
      const token = localStorage.getItem('busgo_token')
      const params = new URLSearchParams({ lat: osmCentre.lat, lon: osmCentre.lon, radiusMeters: String(osmRadius) })
      if (osmFilter.trim()) params.set('filter', osmFilter.trim())
      const res = await apiRequest(`/api/admin/stops/osm-search?${params}`, { authToken: token })
      setOsmResults(res.data || [])
      // Pre-tick everything that isn't already stored.
      const preset = {}
      for (const s of res.data || []) if (!s.alreadyExists) preset[s.name] = true
      setOsmChosen(preset)
    } catch (err) {
      setOsmError(err.message)
    } finally {
      setOsmBusy(false)
    }
  }

  const osmImport = async () => {
    const chosen = (osmResults || []).filter(s => osmChosen[s.name] && !s.alreadyExists)
    if (chosen.length === 0) { setOsmError('Nothing selected to import.'); return }
    setOsmBusy(true); setOsmError('')
    try {
      const token = localStorage.getItem('busgo_token')
      const res = await apiRequest('/api/admin/stops/osm-import', {
        method: 'POST', authToken: token, body: JSON.stringify(chosen),
      })
      setOsmOpen(false); setOsmResults(null); setOsmChosen({})
      fetchStops()
      alert(res.message || 'Stops imported')
    } catch (err) {
      setOsmError(err.message)
    } finally {
      setOsmBusy(false)
    }
  }

  const fetchStops = () => apiRequest('/api/admin/stops').then(res => setStops(res.data)).catch(console.error)

  // Fill the coordinates from the device's GPS, so a stop can be added while
  // standing at it instead of looking the numbers up.
  const handleUseMyLocation = () => {
    setLocateError('')
    if (!('geolocation' in navigator)) {
      setLocateError('This browser has no location support.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData(prev => ({
          ...prev,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setLocating(false)
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : 'Could not get a location fix. Location needs https (or localhost).'
        )
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  useEffect(() => {
    fetchStops()
  }, [])

  const handleDelete = async (stopId) => {
    if (!confirm('Delete this stop? This cannot be undone.')) return
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest(`/api/admin/stops/${stopId}`, { method: 'DELETE', authToken: token })
      fetchStops()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest('/api/admin/stops', {
        method: 'POST',
        authToken: token,
        body: JSON.stringify({
          name: formData.name,
          latitude: formData.latitude ? Number(formData.latitude) : null,
          longitude: formData.longitude ? Number(formData.longitude) : null
        })
      })
      setIsModalOpen(false)
      setFormData({ name: '', latitude: '', longitude: '' })
      fetchStops()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="page-title">Stops</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setOsmOpen(true)} className="btn-secondary btn-sm">
            <MapPin size={18} /> Import from OpenStreetMap
          </button>
          <button onClick={() => setIsModalOpen(true)} className="btn-primary btn-sm">
            <Plus size={18} /> Add Stop
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-hover/40 text-text-secondary border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Stop Name</th>
                <th className="px-6 py-4 font-medium">Coordinates</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {stops.map(s => (
                <tr key={s.id} className="hover:bg-hover/30 transition-colors">
                  <td className="px-6 py-4 font-medium flex items-center gap-2">
                    <MapPin size={16} className="text-text-secondary" />
                    {s.name}
                  </td>
                  <td className="px-6 py-4 text-text-secondary">
                    {s.latitude && s.longitude
                      ? `${s.latitude}, ${s.longitude}`
                      : <span className="text-amber-400">Not provided &mdash; no geofence</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => handleDelete(s.id)} className="text-text-secondary hover:text-red-400 p-1 ml-2"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {stops.length === 0 && (
                <tr><td colSpan="3" className="px-6 py-8 text-center text-text-secondary">No stops found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={osmOpen} onClose={() => setOsmOpen(false)} title="Import stops from OpenStreetMap">
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Pulls surveyed bus-stop positions from OpenStreetMap into your stop list.
            This only adds stop reference data &mdash; live bus tracking is unaffected,
            and existing stops are never modified.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Centre latitude</label>
              <input type="number" step="any" value={osmCentre.lat} onChange={e => setOsmCentre({ ...osmCentre, lat: e.target.value })} className="input" placeholder="12.9778" />
            </div>
            <div>
              <label className="label">Centre longitude</label>
              <input type="number" step="any" value={osmCentre.lon} onChange={e => setOsmCentre({ ...osmCentre, lon: e.target.value })} className="input" placeholder="77.5714" />
            </div>
          </div>

          <button type="button" onClick={osmUseMyLocation} disabled={osmBusy} className="btn-secondary btn-block btn-sm">
            <MapPin size={16} /> Use my current location
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Radius</label>
              <select value={osmRadius} onChange={e => setOsmRadius(Number(e.target.value))} className="input">
                <option value={500}>500 m</option>
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
                <option value={5000}>5 km</option>
                <option value={10000}>10 km</option>
              </select>
            </div>
            <div>
              <label className="label">Name contains (optional)</label>
              <input type="text" value={osmFilter} onChange={e => setOsmFilter(e.target.value)} className="input" placeholder="e.g. TTMC" />
            </div>
          </div>

          <button type="button" onClick={osmSearch} disabled={osmBusy} className="btn-primary btn-block">
            {osmBusy ? 'Searching OpenStreetMap...' : 'Search'}
          </button>

          {osmError && <p className="text-xs text-red-400">{osmError}</p>}

          {osmResults && (
            <div>
              <p className="text-xs text-text-secondary mb-2">
                {osmResults.length} found &mdash; {osmResults.filter(s => !s.alreadyExists).length} new
              </p>
              <div className="max-h-64 overflow-y-auto border border-border-subtle rounded-xl divide-y divide-border-subtle">
                {osmResults.length === 0 && (
                  <p className="p-4 text-sm text-text-secondary text-center">No bus stops mapped in this area.</p>
                )}
                {osmResults.map(s => (
                  <label key={s.name} className={`flex items-center gap-3 p-3 text-sm ${s.alreadyExists ? 'opacity-50' : 'cursor-pointer hover:bg-hover/40'}`}>
                    <input
                      type="checkbox"
                      disabled={s.alreadyExists}
                      checked={!!osmChosen[s.name] && !s.alreadyExists}
                      onChange={e => setOsmChosen({ ...osmChosen, [s.name]: e.target.checked })}
                      className="accent-accent w-4 h-4 shrink-0"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{s.name}</span>
                      <span className="block text-xs text-text-secondary">
                        {s.latitude}, {s.longitude} · {s.distanceMeters} m away
                        {s.alreadyExists && ' · already added'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={osmImport} disabled={osmBusy} className="w-full bg-accent hover:bg-accent/90 text-white py-2.5 rounded-lg font-medium mt-4 disabled:opacity-50">
                Import selected
              </button>
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Stop">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Stop Name</label>
            <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="input" placeholder="e.g. Majestic Bus Stand" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Latitude</label>
              <input type="number" step="any" value={formData.latitude} onChange={e => setFormData({...formData, latitude: e.target.value})} className="input" placeholder="12.9778" />
            </div>
            <div>
              <label className="label">Longitude</label>
              <input type="number" step="any" value={formData.longitude} onChange={e => setFormData({...formData, longitude: e.target.value})} className="input" placeholder="77.5714" />
            </div>
          </div>
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locating}
            className="btn-secondary btn-block btn-sm"
          >
            <MapPin size={16} /> {locating ? 'Getting location...' : 'Use my current location'}
          </button>
          {locateError && <p className="text-xs text-red-400">{locateError}</p>}
          <p className="text-xs text-text-secondary">
            A stop without coordinates still appears on routes, but it cannot trigger the
            GPS geofence, so buses will not auto-advance past it.
          </p>
          <button type="submit" className="btn-primary btn-block mt-6">
            Save Stop
          </button>
        </form>
      </Modal>
    </div>
  )
}

function ConductorsTab() {
  const [conductors, setConductors] = useState([])
  const [buses, setBuses] = useState([])
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  
  // Forms state
  const [addFormData, setAddFormData] = useState({ name: '', email: '', password: '' })
  const [assignData, setAssignData] = useState({ conductorId: null, busId: '' })
  
  const fetchConductors = () => apiRequest('/api/admin/conductors').then(res => setConductors(res.data)).catch(console.error)
  const fetchBuses = () => apiRequest('/api/admin/buses').then(res => setBuses(res.data)).catch(console.error)

  useEffect(() => {
    fetchConductors()
    fetchBuses()
  }, [])

  const handleAddSubmit = async (e) => {
    e.preventDefault()
    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: addFormData.name,
          email: addFormData.email,
          password: addFormData.password,
          role: 'CONDUCTOR'
        })
      })
      setIsAddModalOpen(false)
      setAddFormData({ name: '', email: '', password: '' })
      fetchConductors()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleAssignSubmit = async (e) => {
    e.preventDefault()
    if (!assignData.busId) return alert('Please select a bus')
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest(`/api/buses/${assignData.busId}/assign-conductor/${assignData.conductorId}`, {
        method: 'POST',
        authToken: token
      })
      setIsAssignModalOpen(false)
      setAssignData({ conductorId: null, busId: '' })
      alert('Conductor successfully assigned to bus!')
      fetchConductors()
      fetchBuses()
    } catch (err) {
      alert(err.message)
    }
  }

  const openAssignModal = (conductorId) => {
    setAssignData({ conductorId, busId: '' })
    setIsAssignModalOpen(true)
  }

  const handleDelete = async (conductorId) => {
    if (!confirm('Delete this conductor? This cannot be undone.')) return
    try {
      const token = localStorage.getItem('busgo_token')
      await apiRequest(`/api/admin/conductors/${conductorId}`, { method: 'DELETE', authToken: token })
      fetchConductors()
      fetchBuses()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="page-title">Assign Conductors</h2>
        <button onClick={() => setIsAddModalOpen(true)} className="btn-primary btn-sm">
          <Plus size={18} /> Add Conductor
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-hover/40 text-text-secondary border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Email</th>
                <th className="px-6 py-4 font-medium">Assignment</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {conductors.map(c => (
                <tr key={c.id} className="hover:bg-hover/30 transition-colors">
                  <td className="px-6 py-4 font-medium flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                      {(c.name || c.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    {c.name || 'Unknown Name'}
                  </td>
                  <td className="px-6 py-4 text-text-secondary">{c.email}</td>
                  <td className="px-6 py-4 text-text-secondary">
                    {c.assignedBus ? (
                      <span className="bg-accent/20 text-accent px-2 py-1 rounded-full text-xs font-medium">Bus {c.assignedBus.busNumber}</span>
                    ) : (
                      <span className="bg-dark text-text-secondary px-2 py-1 rounded-full text-xs border border-border-subtle">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => openAssignModal(c.id)}
                      className="bg-accent/10 text-accent hover:bg-accent hover:text-white px-3 py-1.5 rounded-lg font-medium transition-colors text-xs mr-2"
                    >
                      Assign to Bus
                    </button>
                    <button onClick={() => handleDelete(c.id)} className="text-text-secondary hover:text-red-400 p-1"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
              {conductors.length === 0 && (
                <tr><td colSpan="4" className="px-6 py-8 text-center text-text-secondary">No conductors found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Conductor Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Create New Conductor">
        <form onSubmit={handleAddSubmit} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input type="text" required value={addFormData.name} onChange={e => setAddFormData({...addFormData, name: e.target.value})} className="input" placeholder="e.g. John Doe" />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" required value={addFormData.email} onChange={e => setAddFormData({...addFormData, email: e.target.value})} className="input" placeholder="conductor@busgo.ai" />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" required value={addFormData.password} onChange={e => setAddFormData({...addFormData, password: e.target.value})} className="input" placeholder="••••••••" />
          </div>
          <button type="submit" className="btn-primary btn-block mt-6">
            Create Conductor
          </button>
        </form>
      </Modal>

      {/* Assign Bus Modal */}
      <Modal isOpen={isAssignModalOpen} onClose={() => setIsAssignModalOpen(false)} title="Assign to Bus">
        <form onSubmit={handleAssignSubmit} className="space-y-4">
          <div>
            <label className="label">Select Bus</label>
            <select required value={assignData.busId} onChange={e => setAssignData({...assignData, busId: e.target.value})} className="input">
              <option value="" disabled>Select a bus...</option>
              {buses.map(b => (
                <option key={b.id} value={b.id}>{b.busNumber} (Capacity: {b.capacity})</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary btn-block mt-6">
            Confirm Assignment
          </button>
        </form>
      </Modal>
    </div>
  )
}

function AnalyticsTab() {
  const [reports, setReports] = useState(null)
  
  useEffect(() => {
    apiRequest('/api/admin/reports').then(res => setReports(res.data)).catch(console.error)
  }, [])

  if (!reports) return <div className="text-text-secondary">Loading reports...</div>

  return (
    <div>
      <h2 className="page-title mb-6">Reports & Analytics</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border-subtle rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6 text-text-primary font-medium">
            <TrendingUp size={20} className="text-accent" />
            Busiest Routes
          </div>
          <ul className="space-y-4">
            {Object.entries(reports.busiestRoutes || {}).map(([route, count], index) => (
              <li key={route} className="flex justify-between items-center text-sm">
                <span className="font-medium flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-hover flex items-center justify-center text-xs text-text-secondary">{index + 1}</span>
                  {route}
                </span>
                <span className="text-text-secondary bg-dark px-3 py-1 rounded-full border border-border-subtle">
                  {count} passengers
                </span>
              </li>
            ))}
            {Object.keys(reports.busiestRoutes || {}).length === 0 && (
              <li className="text-text-secondary text-sm">Not enough data collected yet.</li>
            )}
          </ul>
        </div>

        <div className="bg-card border border-border-subtle rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6 text-text-primary font-medium">
            <MapPin size={20} className="text-orange-400" />
            Busiest Stops
          </div>
          <ul className="space-y-4">
            {Object.entries(reports.busiestStops || {}).map(([stop, count], index) => (
              <li key={stop} className="flex justify-between items-center text-sm">
                <span className="font-medium flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-hover flex items-center justify-center text-xs text-text-secondary">{index + 1}</span>
                  {stop}
                </span>
                <span className="text-text-secondary bg-dark px-3 py-1 rounded-full border border-border-subtle">
                  {count} footfalls
                </span>
              </li>
            ))}
            {Object.keys(reports.busiestStops || {}).length === 0 && (
              <li className="text-text-secondary text-sm">Not enough data collected yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

// --- Phase 8: ML Predictions panel ---
function heatColor(occ, cap) {
  const frac = cap > 0 ? occ / cap : 0
  if (frac >= 0.9) return 'bg-crowd-full'
  if (frac >= 0.6) return 'bg-crowd-high'
  if (frac >= 0.3) return 'bg-crowd-mod'
  if (occ > 0) return 'bg-crowd-low'
  return 'bg-hover'
}

function PredictionsTab() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('busgo_token')
    apiRequest('/api/admin/predictions/summary', { authToken: token })
      .then(res => setSummary(res.data))
      .catch(err => setError(err.message))
  }, [])

  if (error) return <div className="text-red-400">Failed to load predictions: {error}</div>
  if (!summary) return <div className="text-text-secondary">Loading predictions...</div>

  const trainedLabel = summary.lastTrainedAt
    ? new Date(summary.lastTrainedAt).toLocaleString()
    : 'Not trained yet'
  const cap = summary.nominalCapacity || 50
  const dowNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const statCards = [
    { title: 'Occupancy Model', value: summary.modelActive ? 'Active' : 'Cold (heuristic)', icon: Brain, color: summary.modelActive ? 'text-emerald-400' : 'text-text-secondary' },
    { title: 'ETA Model', value: summary.etaModelActive ? 'Active' : 'Cold (heuristic)', icon: Activity, color: summary.etaModelActive ? 'text-emerald-400' : 'text-text-secondary' },
    { title: 'Occupancy RMSE', value: summary.occupancyRmse != null ? `${summary.occupancyRmse} seats` : '—', icon: TrendingUp, color: 'text-accent' },
    { title: 'ETA RMSE', value: summary.etaRmse != null ? `${summary.etaRmse}s` : '—', icon: Clock, color: 'text-purple-400' },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Brain size={26} className="text-accent" />
        <h2 className="page-title">AI Predictions</h2>
      </div>
      <p className="text-text-secondary text-sm mb-6">
        RandomForest models trained inside the backend on {summary.occupancySampleCount} occupancy &amp; {summary.travelSampleCount} travel-time samples.
        Last trained: <span className="text-text-primary">{trainedLabel}</span>.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(c => {
          const Icon = c.icon
          return (
            <div key={c.title} className="card-pad">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium mb-2">
                <Icon size={16} className={c.color} /> {c.title}
              </div>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          )
        })}
      </div>

      <div className="bg-card border border-border-subtle rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="font-semibold">Predicted Occupancy by Hour</h3>
          <span className="text-xs text-text-secondary">Representative day: {dowNames[summary.representativeDayOfWeek] || `Day ${summary.representativeDayOfWeek}`} · capacity {cap}</span>
        </div>
        <p className="text-text-secondary text-xs mb-5">Average forecast across each route's stops, per hour of day (0–23).</p>

        {(summary.routes || []).length === 0 ? (
          <div className="text-text-secondary text-sm py-6 text-center">No routes with stops to forecast.</div>
        ) : (
          <div className="space-y-5 overflow-x-auto">
            {/* Hour axis */}
            <div className="flex items-center gap-3 min-w-[720px]">
              <div className="w-40 flex-shrink-0" />
              <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="text-[9px] text-text-secondary text-center">{h % 3 === 0 ? h : ''}</div>
                ))}
              </div>
            </div>
            {summary.routes.map(route => (
              <div key={route.routeId} className="flex items-center gap-3 min-w-[720px]">
                <div className="w-40 flex-shrink-0 truncate text-sm font-medium" title={route.routeName}>{route.routeName}</div>
                <div className="flex-1 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
                  {(route.occupancyByHour || []).map((occ, h) => (
                    <div
                      key={h}
                      className={`h-7 rounded ${heatColor(occ, cap)} transition-colors`}
                      title={`${route.routeName} · ${h}:00 → ${occ} passengers (${cap > 0 ? Math.round((occ / cap) * 100) : 0}%)`}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-4 pt-2 text-xs text-text-secondary">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-crowd-low inline-block" /> Low</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-crowd-mod inline-block" /> Moderate</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-crowd-high inline-block" /> High</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-crowd-full inline-block" /> Full</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
