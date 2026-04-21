import { Shirt, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BUSINESS_LIST, type BusinessId } from '../../../lib/db/business'
import { useAuth } from '../use-auth'

const BUSINESS_ICONS: Record<BusinessId, typeof Shirt> = {
  cleaning: Sparkles,
  laundry: Shirt,
}

export function SelectBusinessPage() {
  const { activeBusiness, selectBusiness, signOut, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState<BusinessId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const redirectTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/dashboard'

  async function handlePick(business: BusinessId) {
    if (pending) return
    setPending(business)
    setError(null)
    try {
      const ok = await selectBusiness(business)
      if (!ok) {
        setError(
          `Your account does not exist in the ${
            BUSINESS_LIST.find((b) => b.id === business)?.name ?? business
          } database. Ask an admin to create the account there, or pick a different business.`,
        )
        return
      }
      navigate(redirectTo, { replace: true })
    } catch (pickError: unknown) {
      setError(
        pickError instanceof Error
          ? pickError.message
          : 'Unable to switch businesses right now.',
      )
    } finally {
      setPending(null)
    }
  }

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <section className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Select a business
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {user ? `Signed in as ${user.displayName}. ` : ''}
            Choose which business you want to work with. Each one keeps its
            data fully isolated in a separate database.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {BUSINESS_LIST.map((business) => {
            const Icon = BUSINESS_ICONS[business.id]
            const isActive = business.id === activeBusiness
            const isPending = pending === business.id
            return (
              <button
                key={business.id}
                className="group flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 text-left transition hover:border-[var(--accent)] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                data-tour="business-card"
                disabled={Boolean(pending)}
                onClick={() => handlePick(business.id)}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: business.accent }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold">
                        {business.name}
                      </h2>
                      {isActive && (
                        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-strong)]">
                          Last used
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {business.tagline}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end text-xs text-[var(--muted)]">
                  <span className="font-medium text-[var(--accent-strong)] opacity-0 transition group-hover:opacity-100">
                    {isPending ? 'Loading…' : 'Continue →'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <button
            className="text-xs font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
            onClick={handleSignOut}
            type="button"
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  )
}
