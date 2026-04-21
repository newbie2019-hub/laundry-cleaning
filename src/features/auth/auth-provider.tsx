import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  DEFAULT_BUSINESS,
  getActiveBusinessId,
  setActiveBusinessId,
  type BusinessId,
} from '../../lib/db/business'
import {
  AuthContext,
  BUSINESS_SELECTED_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  type AuthContextValue,
} from './auth-context'
import {
  getUserSession,
  getUserSessionByUsername,
  loginWithCredentials,
} from './auth-service'
import type { AuthUser } from './auth-types'
import { useAuth } from './use-auth'

function isAdmin(user: AuthUser | null) {
  return user?.roles.includes('admin') ?? false
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [storedUserId] = useState(() => window.localStorage.getItem(SESSION_STORAGE_KEY))
  const [status, setStatus] = useState<'loading' | 'ready'>(() =>
    storedUserId ? 'loading' : 'ready',
  )
  const [user, setUser] = useState<AuthUser | null>(null)
  const [activeBusiness, setActiveBusinessState] = useState<BusinessId>(() =>
    getActiveBusinessId(),
  )
  const [hasSelectedBusiness, setHasSelectedBusiness] = useState<boolean>(() =>
    window.localStorage.getItem(BUSINESS_SELECTED_STORAGE_KEY) === '1',
  )

  useEffect(() => {
    if (!storedUserId) {
      return
    }

    getUserSession(Number(storedUserId))
      .then((sessionUser) => {
        if (!sessionUser) {
          window.localStorage.removeItem(SESSION_STORAGE_KEY)
          window.localStorage.removeItem(BUSINESS_SELECTED_STORAGE_KEY)
          setHasSelectedBusiness(false)
          setUser(null)
          return
        }

        setUser(sessionUser)
      })
      .finally(() => {
        setStatus('ready')
      })
  }, [storedUserId])

  const value = useMemo<AuthContextValue>(
    () => ({
      activeBusiness,
      hasPermission(permissionKey: string) {
        return user?.roles.includes('admin') || user?.permissions.includes(permissionKey) || false
      },
      hasSelectedBusiness,
      isAuthenticated: user !== null,
      async refreshSession() {
        if (!user) return
        const refreshed = await getUserSession(user.id)
        if (refreshed) setUser(refreshed)
      },
      async selectBusiness(business: BusinessId) {
        const previous = getActiveBusinessId()
        setActiveBusinessId(business)
        setActiveBusinessState(business)

        if (!user) {
          window.localStorage.setItem(BUSINESS_SELECTED_STORAGE_KEY, '1')
          setHasSelectedBusiness(true)
          return true
        }

        // Re-resolve the session in the newly active database. If the current
        // user does not exist in the target business (e.g. a manager that was
        // only created in the Laundry database), roll back and report failure
        // so the UI can warn the user.
        const refreshed = await getUserSessionByUsername(user.username)

        if (!refreshed) {
          setActiveBusinessId(previous)
          setActiveBusinessState(previous)
          return false
        }

        setUser(refreshed)
        window.localStorage.setItem(SESSION_STORAGE_KEY, String(refreshed.id))
        window.localStorage.setItem(BUSINESS_SELECTED_STORAGE_KEY, '1')
        setHasSelectedBusiness(true)
        return true
      },
      async signIn(username: string, password: string) {
        const sessionUser = await loginWithCredentials(username, password)

        if (!sessionUser) {
          return false
        }

        setUser(sessionUser)
        window.localStorage.setItem(SESSION_STORAGE_KEY, String(sessionUser.id))

        // Admins must explicitly confirm which business they're operating on
        // every session. Non-admin accounts stay pinned to the currently
        // active business since they were created in that specific tenant.
        if (isAdmin(sessionUser)) {
          window.localStorage.removeItem(BUSINESS_SELECTED_STORAGE_KEY)
          setHasSelectedBusiness(false)
        } else {
          window.localStorage.setItem(BUSINESS_SELECTED_STORAGE_KEY, '1')
          setHasSelectedBusiness(true)
        }
        return true
      },
      signOut() {
        setUser(null)
        window.localStorage.removeItem(SESSION_STORAGE_KEY)
        window.localStorage.removeItem(BUSINESS_SELECTED_STORAGE_KEY)
        setHasSelectedBusiness(false)
        // Reset to the default tenant so the next login lands on a known DB.
        setActiveBusinessId(DEFAULT_BUSINESS)
        setActiveBusinessState(DEFAULT_BUSINESS)
      },
      status,
      user,
    }),
    [activeBusiness, hasSelectedBusiness, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-sm text-[var(--muted)]">
        Restoring session...
      </div>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <Navigate
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
        to="/login"
      />
    )
  }

  return <Outlet />
}

export function RequireBusinessSelected() {
  const auth = useAuth()

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-sm text-[var(--muted)]">
        Loading...
      </div>
    )
  }

  if (!auth.hasSelectedBusiness) {
    return <Navigate replace to="/select-business" />
  }

  return <Outlet />
}

export function RedirectIfAuthenticated({ children }: PropsWithChildren) {
  const auth = useAuth()

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-sm text-[var(--muted)]">
        Loading...
      </div>
    )
  }

  if (auth.isAuthenticated) {
    if (!auth.hasSelectedBusiness) {
      return <Navigate replace to="/select-business" />
    }
    return <Navigate replace to="/dashboard" />
  }

  return children
}
