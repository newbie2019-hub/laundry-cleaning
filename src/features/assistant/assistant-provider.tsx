import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import type { AssistantMessage, CreatePreview, QueryIntent, CreateIntent } from './types'
import { AssistantContext } from './assistant-context'
import { checkOnline } from './lib/connectivity'
import { parseLocal, ensureDefaultDateRange } from './lib/local-parser'
import { parseCloud } from './lib/cloud-parser'
import { runQuery } from './lib/query-engine'
import { buildPreview, executeCreate } from './lib/create-engine'
import { loadAssistantSettings, getActiveApiKey } from '../../lib/assistant-settings'
import { useAuth } from '../auth/use-auth'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function AssistantProvider({ children }: PropsWithChildren) {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hi! Ask me anything about your business.\n\n• Sales analytics\n• Expense summaries\n• Customer history\n• Inventory status\n• Staff attendance\n• Payroll summaries\n\nI can also create records when you describe them in plain text.',
      timestamp: new Date(),
    },
  ])

  const onlineRef = useRef(online)
  onlineRef.current = online

  // Poll online status every 30s when open
  useEffect(() => {
    void checkOnline().then(setOnline)
    const id = setInterval(() => {
      void checkOnline().then(setOnline)
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const addMessage = useCallback((msg: AssistantMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const updateMessage = useCallback((id: string, update: Partial<AssistantMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)))
  }, [])

  const openAssistant = useCallback(() => setIsOpen(true), [])
  const closeAssistant = useCallback(() => setIsOpen(false), [])
  const clearMessages = useCallback(() => {
    setMessages((prev) => prev.filter((m) => m.id === 'welcome'))
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: AssistantMessage = {
      id: generateId(),
      role: 'user',
      text,
      timestamp: new Date(),
    }
    addMessage(userMsg)
    setIsProcessing(true)

    const processingId = generateId()
    addMessage({ id: processingId, role: 'assistant', text: '…', timestamp: new Date() })

    try {
      const settings = loadAssistantSettings()
      const activeKey = getActiveApiKey(settings)
      const isCurrentlyOnline = await checkOnline()
      setOnline(isCurrentlyOnline)

      let parsedIntent = parseLocal(text)
      let usedCloud = false

      if (isCurrentlyOnline && activeKey && settings.enabled) {
        const result = await parseCloud(text, { provider: activeKey.provider, apiKey: activeKey.apiKey, model: activeKey.model })
        parsedIntent = result.intent
        usedCloud = result.usedCloud
      }

      // Ensure default date range for queries
      const intent = ensureDefaultDateRange(parsedIntent)

      if (intent.kind === 'unknown') {
        updateMessage(processingId, {
          text: "I'm not sure what you're asking. Try:\n• \"What were my sales today?\"\n• \"Who was present yesterday?\"\n• \"Add customer Juan Dela Cruz phone 09123456789\"\n• \"Mark Reyes was present today multiplier 1.5\"",
          parserUsed: usedCloud ? 'cloud' : 'local',
        })
        return
      }

      if (intent.kind === 'query') {
        const answer = await runQuery(intent as QueryIntent)
        updateMessage(processingId, {
          text: answer,
          parserUsed: usedCloud ? 'cloud' : 'local',
        })
      } else if (intent.kind === 'create') {
        const preview = await buildPreview(intent as CreateIntent)
        updateMessage(processingId, {
          text: 'I found the following information. Please review before saving:',
          preview,
          parserUsed: usedCloud ? 'cloud' : 'local',
        })
      }
    } catch (err) {
      console.error('[assistant]', err)
      updateMessage(processingId, {
        text: `Sorry, something went wrong. ${err instanceof Error ? err.message : 'Please try again.'}`,
      })
    } finally {
      setIsProcessing(false)
    }
  }, [addMessage, updateMessage])

  const confirmCreate = useCallback(async (preview: CreatePreview, messageId: string) => {
    if (!user) return
    setIsProcessing(true)
    const confirmingId = generateId()
    addMessage({ id: confirmingId, role: 'assistant', text: 'Saving…', timestamp: new Date() })
    try {
      const result = await executeCreate(preview, user.id)
      updateMessage(confirmingId, { text: result })
      // Mark the original preview message as confirmed
      updateMessage(messageId, { preview: undefined })
    } catch (err) {
      updateMessage(confirmingId, {
        text: `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    } finally {
      setIsProcessing(false)
    }
  }, [user, addMessage, updateMessage])

  const cancelCreate = useCallback((messageId: string) => {
    updateMessage(messageId, { preview: undefined })
    addMessage({
      id: generateId(),
      role: 'assistant',
      text: 'Cancelled. No record was saved.',
      timestamp: new Date(),
    })
  }, [addMessage, updateMessage])

  return (
    <AssistantContext.Provider value={{
      isOpen,
      isProcessing,
      messages,
      online,
      openAssistant,
      closeAssistant,
      sendMessage,
      confirmCreate,
      cancelCreate,
      clearMessages,
    }}>
      {children}
    </AssistantContext.Provider>
  )
}
