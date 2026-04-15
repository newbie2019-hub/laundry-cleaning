import { createContext } from 'react'
import type { AuthUser } from './auth-types'

export type AuthContextValue = {
  hasPermission: (permissionKey: string) => boolean
  isAuthenticated: boolean
  signIn: (username: string, password: string) => Promise<boolean>
  signOut: () => void
  status: 'loading' | 'ready'
  user: AuthUser | null
}

export const SESSION_STORAGE_KEY = 'business-ledger.session.user-id'

export const AuthContext = createContext<AuthContextValue | null>(null)
