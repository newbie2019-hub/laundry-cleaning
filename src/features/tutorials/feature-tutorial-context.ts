import { createContext } from 'react'

export type FeatureTutorialContextValue = {
  isActive: boolean
  isCompleted: boolean
  start: () => void
  stop: () => void
  restart: () => void
}

export const FeatureTutorialContext =
  createContext<FeatureTutorialContextValue | null>(null)
