import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Bus, Mail, Lock, ArrowRight, ShieldCheck, UserCircle } from 'lucide-react'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, logout } = useAuth()
  
  // New role selection state
  const [selectedRole, setSelectedRole] = useState('ADMIN')
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await login(form)
      const user = response?.data?.user || response?.user

      if (selectedRole === 'ADMIN' && user?.role !== 'ADMIN') {
        logout();
        throw new Error("Access Denied: You selected Admin, but your account is not an Admin account.");
      }
      
      if (selectedRole === 'CONDUCTOR' && user?.role !== 'CONDUCTOR') {
        logout();
        throw new Error("Access Denied: You selected Conductor, but your account is not a Conductor account.");
      }
      
      let redirect = location.state?.from?.pathname
      if (!redirect || redirect === '/login') {
        if (user?.role === 'ADMIN') {
          redirect = '/admin'
        } else if (user?.role === 'CONDUCTOR') {
          redirect = '/dashboard'
        }
      }
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const isConductor = selectedRole === 'CONDUCTOR';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-dark relative overflow-hidden min-h-screen">
      {/* Decorative background elements */}
      <div className={`absolute top-1/4 left-1/4 w-96 h-96 ${isConductor ? 'bg-orange-400/20' : 'bg-accent/20'} rounded-full blur-[100px] -z-10 transition-colors duration-500`} />
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 ${isConductor ? 'bg-red-500/10' : 'bg-purple-500/10'} rounded-full blur-[100px] -z-10 transition-colors duration-500`} />

      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="bg-accent text-white p-4 rounded-2xl shadow-lg shadow-accent/20">
            <Bus size={36} />
          </div>
        </div>

        <div className="bg-card/80 backdrop-blur-xl rounded-3xl border border-border-subtle p-8 shadow-soft">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">
              Welcome to BusGo AI
            </h2>
            <p className="text-sm text-text-secondary">
              Smart Bus Tracking & Occupancy Prediction
            </p>
          </div>

          <div className="mb-6">
             <label className="block text-sm font-medium text-text-secondary mb-3 text-center">
                Choose your role to continue
             </label>
             <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRole('ADMIN')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    selectedRole === 'ADMIN'
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border-subtle bg-dark text-text-secondary hover:border-text-secondary'
                  }`}
                >
                   <ShieldCheck size={24} className="mb-2" />
                   <span className="font-semibold text-sm">ADMIN</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRole('CONDUCTOR')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    selectedRole === 'CONDUCTOR'
                      ? 'border-orange-400 bg-orange-400/10 text-orange-400'
                      : 'border-border-subtle bg-dark text-text-secondary hover:border-text-secondary'
                  }`}
                >
                   <UserCircle size={24} className="mb-2" />
                   <span className="font-semibold text-sm">CONDUCTOR</span>
                </button>
             </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary" size={20} />
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className="w-full bg-dark border border-border-subtle rounded-xl py-3 pl-12 pr-4 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent transition-colors"
                  placeholder={isConductor ? "conductor@busgo.ai" : "admin@busgo.ai"}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary" size={20} />
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className="w-full bg-dark border border-border-subtle rounded-xl py-3 pl-12 pr-4 text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent transition-colors"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full flex items-center justify-center gap-2 text-white rounded-xl py-3 font-semibold transition-all disabled:opacity-50 ${isConductor ? 'bg-orange-500 hover:bg-orange-600' : 'bg-accent hover:bg-accent/90'}`}
            >
              {loading ? 'Signing in...' : 'Sign in'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>
          
          <div className="mt-6 flex flex-col items-center gap-2">
             <Link to="/home" className="text-sm font-medium text-text-secondary hover:text-white transition-colors">
                Continue as Guest Passenger →
             </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
