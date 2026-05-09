import { useContext } from 'react'
import {
  FeatureTutorialContext,
  type FeatureTutorialContextValue,
} from './feature-tutorial-context'

export function useFeatureTutorial(): FeatureTutorialContextValue {
  const ctx = useContext(FeatureTutorialContext)
  if (!ctx) {
    throw new Error(
      'useFeatureTutorial must be used within a FeatureTutorialProvider',
    )
  }
  return ctx
}
