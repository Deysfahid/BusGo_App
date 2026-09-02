// Same-origin by default: the dev server proxies /api to the backend (see
// vite.config.js), so opening the app from a phone at http://<laptop-ip>:5173
// works with no extra config. Deployments set VITE_API_URL to the API's origin.
const apiBase = import.meta.env.VITE_API_URL || ''

export const apiRequest = async (path, options = {}) => {
  const { authToken, ...fetchOptions } = options
  const token = authToken || localStorage.getItem('busgo_token')
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
    ...fetchOptions,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Include the status and URL when the body carries no message - a bare
    // "Request failed" hides whether this was a 404 (request never reached the
    // API) or a real error from it, which matters when testing from a phone.
    const message = data?.message || `Request failed (HTTP ${response.status} on ${apiBase}${path})`
    throw new Error(message)
  }

  return data
}
