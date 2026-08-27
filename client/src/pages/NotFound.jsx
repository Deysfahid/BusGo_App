import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark text-text-primary p-6">
      <div className="max-w-md w-full bg-card border border-border-subtle rounded-3xl p-10 text-center shadow-soft">
        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-5">
          <Compass size={32} className="text-accent" />
        </div>
        <p className="text-xs uppercase tracking-[0.35em] text-text-secondary">404</p>
        <h2 className="mt-3 text-3xl font-bold">Page not found</h2>
        <p className="mt-2 text-sm text-text-secondary">
          The page you requested does not exist. Head back to live tracking.
        </p>
        <Link
          to="/home"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}

export default NotFound
