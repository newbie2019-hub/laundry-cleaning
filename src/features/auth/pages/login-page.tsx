import type { FormEvent } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../use-auth'

// The login screen is shown before a business is selected, so it intentionally
// uses a generic app name instead of the per-tenant app settings value.
const APP_NAME = 'Business Manager'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/dashboard'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const success = await signIn(username.trim(), password)

      if (!success) {
        setError('Invalid username or password.')
        return
      }

      navigate(redirectTo, { replace: true })
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to sign in right now.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)] text-lg font-bold text-white">
            {APP_NAME.charAt(0)}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {APP_NAME}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sign in to continue
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]" htmlFor="username">
              Username
            </label>
            <input
              autoFocus
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none transition placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              id="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter username"
              value={username}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]" htmlFor="password">
              Password
            </label>
            <input
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none transition placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              type="password"
              value={password}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            className="h-10 w-full rounded-lg bg-[var(--accent)] text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={isSubmitting || !username.trim() || !password}
            type="submit"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  )
}
