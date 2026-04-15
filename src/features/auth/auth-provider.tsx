import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthContext, SESSION_STORAGE_KEY, type AuthContextValue } from './auth-context'
import { getUserSession, loginWithCredentials } from './auth-service'
import type { AuthUser } from './auth-types'
import { useAuth } from './use-auth'

export function AuthProvider({ children }: PropsWithChildren) {
  const [storedUserId] = useState(() => window.localStorage.getItem(SESSION_STORAGE_KEY))
  const [status, setStatus] = useState<'loading' | 'ready'>(() =>
    storedUserId ? 'loading' : 'ready',
  )
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    if (!storedUserId) {
      return
    }

    getUserSession(Number(storedUserId))
      .then((sessionUser) => {
        if (!sessionUser) {
          window.localStorage.removeItem(SESSION_STORAGE_KEY)
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
      hasPermission(permissionKey: string) {
        return user?.roles.includes('admin') || user?.permissions.includes(permissionKey) || false
      },
      isAuthenticated: user !== null,
      async signIn(username: string, password: string) {
        const sessionUser = await loginWithCredentials(username, password)

        if (!sessionUser) {
          return false
        }

        setUser(sessionUser)
        window.localStorage.setItem(SESSION_STORAGE_KEY, String(sessionUser.id))
        return true
      },
      signOut() {
        setUser(null)
        window.localStorage.removeItem(SESSION_STORAGE_KEY)
      },
      status,
      user,
    }),
    [status, user],
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
    return <Navigate replace to="/dashboard" />
  }

  return children
}
