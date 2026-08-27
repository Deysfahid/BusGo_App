import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'

const AuthContext = createContext(null)

const tokenKey = 'busgo_token'
const userKey = 'busgo_user'

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey))
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(userKey)
    return stored ? JSON.parse(stored) : null
  })

  const persist = useCallback((nextToken, nextUser) => {
    if (nextToken) {
      localStorage.setItem(tokenKey, nextToken)
    } else {
      localStorage.removeItem(tokenKey)
    }

    if (nextUser) {
      localStorage.setItem(userKey, JSON.stringify(nextUser))
    } else {
      localStorage.removeItem(userKey)
    }
  }, [])

  const login = useCallback(async (payload) => {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const { token, user } = response.data || response // fallback in case api format changes
    setToken(token)
    setUser(user)
    persist(token, user)
    return response
  }, [persist])

  const register = useCallback(async (payload) => {
    const response = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const { token, user } = response.data || response
    setToken(token)
    setUser(user)
    persist(token, user)
    return response
  }, [persist])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    persist(null, null)
  }, [persist])

  const value = useMemo(
    () => ({
      token,
      user,
      login,
      register,
      logout,
      isAuthenticated: Boolean(token),
    }),
    [token, user, login, register, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
