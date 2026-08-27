import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LayoutDashboard, Bus, Route as RouteIcon, MapPin, Users, LogOut, Map, Home as HomeIcon, LogIn, BarChart3 } from 'lucide-react'

const DashboardLayout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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

  return (
    <div className="flex min-h-screen bg-dark text-text-primary">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border-subtle bg-card hidden md:flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="bg-accent text-white p-2 rounded-lg">
              <Bus size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">BusGo AI</h1>
              <p className="text-xs text-text-secondary uppercase tracking-widest">{portalName}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const Icon = item.icon
            // Check if active: exact match for root paths, or startsWith for subpaths if applicable
            const isActive = location.pathname === item.path || (item.path !== '/admin' && item.path !== '/dashboard' && item.path !== '/home' && location.pathname.startsWith(item.path))
            return (
              <NavLink
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  isActive 
                    ? 'bg-accent/10 text-accent font-medium' 
                    : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                }`}
              >
                <Icon size={20} className={isActive ? 'text-accent' : ''} />
                {item.name}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-4 border-t border-border-subtle">
          {user ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl bg-hover/50">
                <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-text-secondary truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-text-secondary hover:bg-hover hover:text-red-400 transition-colors"
              >
                <LogOut size={20} />
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-text-secondary hover:bg-hover hover:text-accent transition-colors"
            >
              <LogIn size={20} />
              Staff Login
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Mobile Header */}
        <header className="md:hidden flex-none flex items-center justify-between p-4 border-b border-border-subtle bg-card z-10">
          <div className="flex items-center gap-2">
            <div className="bg-accent text-white p-1.5 rounded-md">
              <Bus size={20} />
            </div>
            <h1 className="text-lg font-bold">BusGo AI</h1>
          </div>
          {user ? (
            <button onClick={handleLogout} className="text-text-secondary p-2">
              <LogOut size={20} />
            </button>
          ) : (
            <button onClick={() => navigate('/login')} className="text-text-secondary p-2">
              <LogIn size={20} />
            </button>
          )}
        </header>

        {/* Scrollable outlet container */}
        <div className="flex-1 overflow-y-auto w-full">
           <Outlet />
        </div>
      </main>
    </div>
  )
}

export default DashboardLayout
