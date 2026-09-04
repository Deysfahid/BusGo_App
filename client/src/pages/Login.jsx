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
    <div className="min-h-screen flex flex-col items-center justify-center p-5 bg-dark relative overflow-hidden">
      {/* One soft wash of colour behind the card, tinted to the selected role. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[560px] h-[560px] rounded-full blur-[130px] transition-colors duration-500 ${
          isConductor ? 'bg-stale/10' : 'bg-accent/10'
        }`}
      />

      <div className="w-full max-w-md relative">
        <div className="flex flex-col items-center mb-7">
          <div className="bg-accent text-white p-3.5 rounded-2xl mb-4">
            <Bus size={30} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to BusGo</h1>
          <p className="text-sm text-text-secondary mt-1">Smart bus tracking &amp; occupancy prediction</p>
        </div>

        <div className="card p-6 sm:p-7">
          <fieldset className="mb-6">
            <legend className="label text-center w-full mb-3">Choose your role to continue</legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedRole('ADMIN')}
                aria-pressed={selectedRole === 'ADMIN'}
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border-2 transition-colors ${
                  selectedRole === 'ADMIN'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle bg-dark text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
              >
                <ShieldCheck size={22} />
                <span className="font-semibold text-sm">Admin</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('CONDUCTOR')}
                aria-pressed={selectedRole === 'CONDUCTOR'}
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border-2 transition-colors ${
                  selectedRole === 'CONDUCTOR'
                    ? 'border-stale bg-stale/10 text-stale'
                    : 'border-border-subtle bg-dark text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
              >
                <UserCircle size={22} />
                <span className="font-semibold text-sm">Conductor</span>
              </button>
            </div>
          </fieldset>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="login-email" className="label">Email address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                  className="input pl-12"
                  placeholder={isConductor ? "conductor@busgo.ai" : "admin@busgo.ai"}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
                <input
                  id="login-password"
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  className="input pl-12"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="bg-danger/10 border border-danger/25 text-danger text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`btn-block min-h-[50px] text-base ${isConductor ? 'btn-primary bg-stale hover:bg-stale/90 text-dark' : 'btn-primary'}`}
            >
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border-subtle text-center">
            <Link to="/home" className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors inline-flex items-center gap-1.5">
              Continue as guest passenger <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
