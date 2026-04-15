import type { FormEvent } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../use-auth'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
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
    <section className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-10">
      <div className="grid w-full gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-8 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[var(--accent-strong)]">
            Sign in
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Local desktop sign-in
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            The app now checks session state first. If there is no active user, this
            screen is shown before the dashboard shell loads.
          </p>

          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5">
            <p className="text-sm font-medium">Seeded admin credentials</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Username: <span className="font-medium text-[var(--foreground)]">admin</span>
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Password: <span className="font-medium text-[var(--foreground)]">admin123</span>
            </p>
          </div>
        </article>

        <article className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-8 shadow-sm">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="username">
                Username
              </label>
              <input
                className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 outline-none transition focus:border-[var(--accent)]"
                id="username"
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 outline-none transition focus:border-[var(--accent)]"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[var(--accent)] px-5 text-sm font-medium text-white disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </article>
      </div>
    </section>
  )
}
