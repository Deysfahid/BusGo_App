import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Bus, Mail, Lock, ArrowRight, ShieldCheck, UserCircle } from 'lucide-react'
import { signInWithGoogle, firebaseEnabled } from '../lib/firebase'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, firebaseLogin, logout } = useAuth()

  // New role selection state
  const [selectedRole, setSelectedRole] = useState('ADMIN')
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Google Sign-In: Firebase verifies the Google identity, the backend decides the
  // BusGo role from the database, then redirects by that role. The role is NEVER
  // chosen here - the role tabs above only apply to email/password login.
  const handleGoogle = async () => {
    setError('')
    setGoogleLoading(true)
    try {
      const idToken = await signInWithGoogle()
      const response = await firebaseLogin(idToken)
      const user = response?.data?.user || response?.user
      let redirect = location.state?.from?.pathname
      if (!redirect || redirect === '/login') {
        redirect = user?.role === 'ADMIN' ? '/admin'
          : user?.role === 'CONDUCTOR' ? '/dashboard' : '/home'
      }
      navigate(redirect, { replace: true })
    } catch (err) {
      // Firebase popup closed / not configured / backend rejection.
      const msg = err?.code === 'auth/popup-closed-by-user'
        ? 'Sign-in cancelled.' : (err.message || 'Google sign-in failed.')
      setError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }

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
      {/* Subtle transit-map motif behind everything: soft roads and a route line
          with stops, echoing the product without competing with the card. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.5]"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 800"
        fill="none"
      >
        <g stroke="#dadce0" strokeWidth="2">
          <path d="M-50 180 H1250" />
          <path d="M-50 620 H1250" />
          <path d="M240 -50 V850" />
          <path d="M900 -50 V850" />
          <path d="M-50 400 H1250" opacity="0.6" />
          <path d="M560 -50 V850" opacity="0.6" />
        </g>
        {/* A single highlighted route line with stops, in the brand blue. */}
        <path d="M120 700 C 380 560, 300 360, 560 300 S 940 220, 1080 120"
              stroke="#1a73e8" strokeWidth="4" strokeLinecap="round" opacity="0.35" />
        {[[120,700],[360,470],[560,300],[820,250],[1080,120]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="7" fill="#ffffff" stroke="#1a73e8" strokeWidth="3" opacity="0.5" />
        ))}
      </svg>
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

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border-subtle" />
            <span className="text-xs text-text-muted">or</span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || !firebaseEnabled}
            title={firebaseEnabled ? 'Sign in with your Google account' : 'Google Sign-In is not configured'}
            className="btn-secondary btn-block min-h-[48px]"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {googleLoading ? 'Signing in…' : 'Continue with Google'}
          </button>
          {!firebaseEnabled && (
            <p className="mt-2 text-xs text-text-muted text-center">Google Sign-In isn’t configured yet.</p>
          )}

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
