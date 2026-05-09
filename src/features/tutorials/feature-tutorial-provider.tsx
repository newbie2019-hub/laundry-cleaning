import type { PropsWithChildren } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../auth/use-auth'
import {
  FeatureTutorialContext,
  type FeatureTutorialContextValue,
} from './feature-tutorial-context'
import { FeatureTutorialOverlay } from './feature-tutorial-overlay'
import {
  isFeatureTutorialCompleted,
  markFeatureTutorialCompleted,
  resetFeatureTutorial,
} from './feature-tutorial-storage'
import type { TutorialStep } from './feature-tutorial-types'

type Props = PropsWithChildren<{
  /** Stable identifier used for the localStorage key (e.g. 'inventory'). */
  featureKey: string
  /** Ordered list of steps for this tutorial. */
  steps: TutorialStep[]
}>

export function FeatureTutorialProvider({
  children,
  featureKey,
  steps,
}: Props) {
  const { user } = useAuth()
  const username = user?.username ?? null

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // We use a counter to force re-reads of localStorage (so the trigger
  // button label flips between Start/Restart immediately after completion).
  const [completionTick, setCompletionTick] = useState(0)

  const isCompleted = useMemo(() => {
    if (!username) return false
    void completionTick
    return isFeatureTutorialCompleted(featureKey, username)
  }, [featureKey, username, completionTick])

  const start = useCallback(() => {
    if (steps.length === 0) return
    setActiveIndex(0)
  }, [steps.length])

  const stop = useCallback(() => {
    setActiveIndex(null)
    if (username) {
      markFeatureTutorialCompleted(featureKey, username)
      setCompletionTick((n) => n + 1)
    }
  }, [featureKey, username])

  const restart = useCallback(() => {
    if (username) {
      resetFeatureTutorial(featureKey, username)
      setCompletionTick((n) => n + 1)
    }
    if (steps.length === 0) return
    setActiveIndex(0)
  }, [featureKey, steps.length, username])

  const handleNext = useCallback(() => {
    if (activeIndex == null) return
    if (activeIndex + 1 >= steps.length) {
      if (username) {
        markFeatureTutorialCompleted(featureKey, username)
        setCompletionTick((n) => n + 1)
      }
      setActiveIndex(null)
      return
    }
    setActiveIndex(activeIndex + 1)
  }, [activeIndex, featureKey, steps.length, username])

  const handleBack = useCallback(() => {
    if (activeIndex == null) return
    if (activeIndex > 0) setActiveIndex(activeIndex - 1)
  }, [activeIndex])

  const handleSkip = useCallback(() => {
    if (username) {
      markFeatureTutorialCompleted(featureKey, username)
      setCompletionTick((n) => n + 1)
    }
    setActiveIndex(null)
  }, [featureKey, username])

  const value = useMemo<FeatureTutorialContextValue>(
    () => ({
      isActive: activeIndex !== null,
      isCompleted,
      restart,
      start,
      stop,
    }),
    [activeIndex, isCompleted, restart, start, stop],
  )

  const activeStep = activeIndex != null ? steps[activeIndex] : null

  return (
    <FeatureTutorialContext.Provider value={value}>
      {children}
      {activeStep && activeIndex != null ? (
        <FeatureTutorialOverlay
          currentIndex={activeIndex}
          onBack={handleBack}
          onNext={handleNext}
          onSkip={handleSkip}
          step={activeStep}
          total={steps.length}
        />
      ) : null}
    </FeatureTutorialContext.Provider>
  )
}
