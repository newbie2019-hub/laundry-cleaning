import { createContext } from 'react'
import type { AssistantMessage, CreatePreview } from './types'

export type AssistantContextValue = {
  isOpen: boolean
  isProcessing: boolean
  messages: AssistantMessage[]
  online: boolean
  openAssistant: () => void
  closeAssistant: () => void
  sendMessage: (text: string) => Promise<void>
  confirmCreate: (preview: CreatePreview, messageId: string) => Promise<void>
  cancelCreate: (messageId: string) => void
  clearMessages: () => void
}

export const AssistantContext = createContext<AssistantContextValue | null>(null)
