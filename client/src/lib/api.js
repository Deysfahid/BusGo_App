const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8080'

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
    const message = data?.message || 'Request failed'
    throw new Error(message)
  }

  return data
}
