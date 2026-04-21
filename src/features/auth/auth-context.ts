import { createContext } from 'react'
import type { BusinessId } from '../../lib/db/business'
import type { AuthUser } from './auth-types'

export type AuthContextValue = {
  activeBusiness: BusinessId
  hasPermission: (permissionKey: string) => boolean
  hasSelectedBusiness: boolean
  isAuthenticated: boolean
  refreshSession: () => Promise<void>
  selectBusiness: (business: BusinessId) => Promise<boolean>
  signIn: (username: string, password: string) => Promise<boolean>
  signOut: () => void
  status: 'loading' | 'ready'
  user: AuthUser | null
}

export const SESSION_STORAGE_KEY = 'business-ledger.session.user-id'
export const BUSINESS_SELECTED_STORAGE_KEY =
  'business-ledger.session.business-confirmed'

export const AuthContext = createContext<AuthContextValue | null>(null)
