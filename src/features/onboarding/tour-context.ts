import { createContext } from 'react'

export type TourContextValue = {
  isActive: boolean
  start: () => void
  stop: () => void
  restart: () => void
}

export const TourContext = createContext<TourContextValue | null>(null)
