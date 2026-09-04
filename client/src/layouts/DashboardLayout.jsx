import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LayoutDashboard, Bus, Route as RouteIcon, MapPin, Users, LogOut, Map, Home as HomeIcon, LogIn, BarChart3, Brain, Menu, X } from 'lucide-react'


const Brand = ({ portalName, compact = false }) => (
  <div className="flex items-center gap-3">
    <div className="bg-accent text-white p-2 rounded-xl shadow-soft shrink-0">
      <Bus size={compact ? 18 : 22} />
    </div>
    <div className="min-w-0">
      <h1 className={`${compact ? 'text-base' : 'text-lg'} font-bold tracking-tight leading-tight`}>BusGo</h1>
      <p className="eyebrow truncate">{portalName}</p>
    </div>
  </div>
)

const NavItems = ({ items, isActivePath, onNavigate }) => (
  <>
    {items.map((item) => {
      const Icon = item.icon
      const isActive = isActivePath(item.path)
      return (
        <NavLink
          key={item.name}
          to={item.path}
          onClick={onNavigate}
          aria-current={isActive ? 'page' : undefined}
          className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-colors ${
            isActive ? 'bg-accent/12 text-accent' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
          }`}
        >
          <Icon size={19} className="shrink-0" />
          <span className="truncate">{item.name}</span>
        </NavLink>
      )
    })}
  </>
)

const AccountBlock = ({ user, onLogout, onLogin }) => (
  user ? (
    <>
      <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl bg-hover/60">
        <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold shrink-0">
          {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
        </div>
        <div className="overflow-hidden">
          <p className="text-sm font-semibold truncate">{user?.name || 'User'}</p>
          <p className="text-xs text-text-secondary truncate">{user?.email}</p>
        </div>
      </div>
      <button onClick={onLogout} className="btn-ghost btn-block justify-start hover:text-danger">
        <LogOut size={19} />
        Sign out
      </button>
    </>
  ) : (
    <button onClick={onLogin} className="btn-secondary btn-block justify-start">
      <LogIn size={19} />
      Staff Login
    </button>
  )
)

const DashboardLayout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // The drawer closes from each nav link's onNavigate, so it never traps the user.

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const role = user?.role || 'GUEST'

  let navItems
  let portalName

  if (role === 'ADMIN') {
    portalName = 'Admin Portal'
    navItems = [
      { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
      { name: 'Buses', path: '/admin/buses', icon: Bus },
      { name: 'Routes', path: '/admin/routes', icon: RouteIcon },
      { name: 'Stops', path: '/admin/stops', icon: MapPin },
      { name: 'Assign Conductors', path: '/admin/conductors', icon: Users },
      { name: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
      { name: 'Predictions', path: '/admin/predictions', icon: Brain },
    ]
  } else if (role === 'CONDUCTOR') {
    portalName = 'Ops Portal'
    navItems = [
      { name: 'Active Trip', path: '/dashboard', icon: Bus },
      { name: 'Live Map', path: '/dashboard/map', icon: Map },
    ]
  } else {
    portalName = 'Live Tracking'
    navItems = [
      { name: 'Home', path: '/home', icon: HomeIcon },
    ]
  }

  const isActivePath = (path) =>
    location.pathname === path ||
    (path !== '/admin' && path !== '/dashboard' && path !== '/home' && location.pathname.startsWith(path))

  return (
    <div className="flex min-h-screen bg-dark text-text-primary">
      {/* Sidebar (desktop) */}
      <aside className="w-64 border-r border-border-subtle bg-card hidden md:flex flex-col shrink-0">
        <div className="p-5 border-b border-border-subtle">
          <Brand portalName={portalName} />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavItems items={navItems} isActivePath={isActivePath} />
        </nav>
        <div className="p-3 border-t border-border-subtle">
          <AccountBlock user={user} onLogout={handleLogout} onLogin={() => navigate('/login')} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden flex-none flex items-center justify-between gap-3 px-4 py-3 border-b border-border-subtle bg-card z-20">
          <Brand portalName={portalName} compact />
          <div className="flex items-center gap-1">
            {user ? (
              <button onClick={handleLogout} aria-label="Sign out" className="btn-ghost px-3">
                <LogOut size={20} />
              </button>
            ) : (
              <button onClick={() => navigate('/login')} aria-label="Staff login" className="btn-ghost px-3">
                <LogIn size={20} />
              </button>
            )}
            {/* Mobile navigation: the sidebar's destinations were previously
                unreachable on a phone, so the same items open in a drawer. */}
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="btn-ghost px-3"
            >
              <Menu size={22} />
            </button>
          </div>
        </header>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <button
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            />
            <div className="relative ml-auto w-72 max-w-[85vw] h-full bg-card border-l border-border-subtle flex flex-col shadow-lift">
              <div className="flex items-center justify-between p-5 border-b border-border-subtle">
                <Brand portalName={portalName} compact />
                <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="btn-ghost px-3">
                  <X size={20} />
                </button>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                <NavItems items={navItems} isActivePath={isActivePath} onNavigate={() => setMenuOpen(false)} />
              </nav>
              <div className="p-3 border-t border-border-subtle">
                <AccountBlock user={user} onLogout={handleLogout} onLogin={() => navigate('/login')} />
              </div>
            </div>
          </div>
        )}

        {/* Scrollable outlet container */}
        <div className="flex-1 overflow-y-auto w-full">
           <Outlet />
        </div>
      </main>
    </div>
  )
}

export default DashboardLayout
