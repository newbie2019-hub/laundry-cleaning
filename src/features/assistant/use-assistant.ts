import { useContext } from 'react'
import { AssistantContext } from './assistant-context'

export function useAssistant() {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used inside AssistantProvider')
  return ctx
}
