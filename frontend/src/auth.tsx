// Session state: bootstraps once, exposes the current user and guards routes.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

export interface CurrentUser {
  id: number
  username: string
  is_admin: boolean
  last_login: string | null
}

interface AuthState {
  user: CurrentUser | null
  channelName: string
  ready: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  channelName: 'LocalLive',
  ready: false,
  refresh: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [channelName, setChannelName] = useState('LocalLive')
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: CurrentUser; channel_name: string }>('/api/auth/me')
      setUser(data.user)
      setChannelName(data.channel_name)
    } catch {
      setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, channelName, ready, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
