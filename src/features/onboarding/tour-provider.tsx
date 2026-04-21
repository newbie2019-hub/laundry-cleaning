import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BUSINESS_LIST } from '../../lib/db/business'
import { useAuth } from '../auth/use-auth'
import { TourContext, type TourContextValue } from './tour-context'
import { TourOverlay } from './tour-overlay'
import { TOUR_STEPS, type TourStep, type TourStepContext } from './tour-steps'
import {
  isTourCompleted,
  markTourCompleted,
  readTourStep,
  resetTourProgress,
  writeTourStep,
} from './tour-storage'

function stepById(id: string | null): TourStep | null {
  if (!id) return null
  return TOUR_STEPS.find((s) => s.id === id) ?? null
}

function firstApplicableStep(ctx: TourStepContext): TourStep | null {
  return TOUR_STEPS.find((s) => s.applicable(ctx)) ?? null
}

function nextApplicableStep(
  fromId: string | null,
  ctx: TourStepContext,
  direction: 1 | -1,
): TourStep | null {
  const startIdx =
    fromId == null
      ? direction === 1
        ? -1
        : TOUR_STEPS.length
      : TOUR_STEPS.findIndex((s) => s.id === fromId)
  let i = startIdx + direction
  while (i >= 0 && i < TOUR_STEPS.length) {
    if (TOUR_STEPS[i].applicable(ctx)) return TOUR_STEPS[i]
    i += direction
  }
  return null
}

export function TourProvider({ children }: PropsWithChildren) {
  const { hasSelectedBusiness, selectBusiness, status, user } = useAuth()
  const navigate = useNavigate()
  const canSwitchBusiness = user?.roles.includes('admin') ?? false

  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  // Guards against double-clicks on Next while selectBusiness is resolving.
  const [isAdvancing, setIsAdvancing] = useState(false)

  const stepContext = useMemo<TourStepContext>(
    () => ({ canSwitchBusiness, hasSelectedBusiness }),
    [canSwitchBusiness, hasSelectedBusiness],
  )

  const username = user?.username ?? null

  // Auto-start or restore the tour when the user session is ready. Runs when
  // the user identity changes (login, switch business, sign out). This is a
  // legitimate effect-driven state sync (not a derived value) because the
  // tour's starting point depends on async storage reads keyed by username.
  useEffect(() => {
    if (status !== 'ready') return
    if (!username) {
      setActiveStepId(null)
      return
    }
    if (isTourCompleted(username)) {
      setActiveStepId(null)
      return
    }
    const stored = readTourStep(username)
    if (stored && stepById(stored)) {
      setActiveStepId(stored)
      return
    }
    const first = firstApplicableStep(stepContext)
    setActiveStepId(first?.id ?? null)
  }, [status, username, stepContext])

  // Persist the active step so it survives page navigation / reload.
  useEffect(() => {
    if (!username) return
    writeTourStep(username, activeStepId)
  }, [username, activeStepId])

  // If the current step becomes inapplicable (e.g. the user just picked a
  // business so the "select-business" step is no longer relevant), auto-skip
  // forward to the next applicable step. Syncing activeStepId with external
  // auth state is what this effect is for.
  useEffect(() => {
    if (!activeStepId) return
    const current = stepById(activeStepId)
    if (!current) return
    if (current.applicable(stepContext)) return
    const next = nextApplicableStep(activeStepId, stepContext, 1)
    if (next) {
      setActiveStepId(next.id)
    } else {
      if (username) markTourCompleted(username)
      setActiveStepId(null)
    }
  }, [activeStepId, stepContext, username])

  const applicableSteps = useMemo(
    () => TOUR_STEPS.filter((s) => s.applicable(stepContext)),
    [stepContext],
  )

  const activeStep = stepById(activeStepId)
  const activeApplicableIndex = activeStep
    ? applicableSteps.findIndex((s) => s.id === activeStep.id)
    : -1

  const handleNext = useCallback(async () => {
    if (!activeStep || isAdvancing) return

    // On the "select-business" step the user is hovering on /select-business
    // waiting to continue. When they click Next we auto-pick the first
    // business for them, then the tour naturally flows into the sidebar step
    // on /dashboard. We assume the default tenant exists for the current
    // admin; if not, fall through to the sidebar step anyway so the user
    // isn't stuck.
    if (activeStep.id === 'select-business' && !hasSelectedBusiness) {
      const firstBusiness = BUSINESS_LIST[0]
      if (firstBusiness) {
        setIsAdvancing(true)
        try {
          const ok = await selectBusiness(firstBusiness.id)
          if (ok) {
            navigate('/dashboard', { replace: true })
            // The applicability-sync effect will auto-advance to the next
            // step once hasSelectedBusiness flips, so we return here.
            return
          }
        } catch {
          // Swallow and fall through to the normal advance below.
        } finally {
          setIsAdvancing(false)
        }
      }
    }

    const next = nextApplicableStep(activeStep.id, stepContext, 1)
    if (next) {
      setActiveStepId(next.id)
      return
    }
    if (username) markTourCompleted(username)
    setActiveStepId(null)
  }, [
    activeStep,
    hasSelectedBusiness,
    isAdvancing,
    navigate,
    selectBusiness,
    stepContext,
    username,
  ])

  const handleBack = useCallback(() => {
    if (!activeStep) return
    const prev = nextApplicableStep(activeStep.id, stepContext, -1)
    if (prev) setActiveStepId(prev.id)
  }, [activeStep, stepContext])

  const handleSkip = useCallback(() => {
    if (username) markTourCompleted(username)
    setActiveStepId(null)
  }, [username])

  const value = useMemo<TourContextValue>(
    () => ({
      isActive: activeStep !== null,
      restart() {
        if (!username) return
        resetTourProgress(username)
        const first = firstApplicableStep(stepContext)
        setActiveStepId(first?.id ?? null)
      },
      start() {
        const first = firstApplicableStep(stepContext)
        setActiveStepId(first?.id ?? null)
      },
      stop: handleSkip,
    }),
    [activeStep, handleSkip, stepContext, username],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeStep && activeApplicableIndex >= 0 && (
        <TourOverlay
          currentIndex={activeApplicableIndex}
          onBack={handleBack}
          onNext={handleNext}
          onSkip={handleSkip}
          step={activeStep}
          total={applicableSteps.length}
        />
      )}
    </TourContext.Provider>
  )
}
