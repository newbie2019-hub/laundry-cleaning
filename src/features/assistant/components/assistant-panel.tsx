import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Trash2, Wifi, WifiOff, X } from 'lucide-react'
import { useAssistant } from '../use-assistant'
import { MessageBubble } from './message-bubble'

export function AssistantPanel() {
  const { clearMessages, closeAssistant, isProcessing, messages, online, sendMessage } = useAssistant()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  function handleSend() {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    void sendMessage(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-6rem)] rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]">
          <Bot className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Business Assistant</p>
          <div className="flex items-center gap-1 mt-0.5">
            {online ? (
              <>
                <Wifi className="h-3 w-3 text-emerald-500" />
                <span className="text-[10px] text-emerald-500">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-[var(--muted)]" />
                <span className="text-[10px] text-[var(--muted)]">Offline — using local parser</span>
              </>
            )}
          </div>
        </div>
        <button
          aria-label="Clear chat"
          className="p-1.5 rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          onClick={clearMessages}
          title="Clear chat"
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label="Close assistant"
          className="p-1.5 rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          onClick={closeAssistant}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions (shown when only welcome message) */}
      {messages.length === 1 && (
        <div className="shrink-0 px-4 pb-3 flex flex-wrap gap-1.5">
          {[
            'What were my sales today?',
            'Who was present yesterday?',
            'Which items need restocking?',
            'How much did I spend this month?',
          ].map((s) => (
            <button
              key={s}
              className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent-strong)]"
              onClick={() => { setInput(s); inputRef.current?.focus() }}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 flex items-end gap-2 px-3 py-3 border-t border-[var(--border)]">
        <textarea
          ref={inputRef}
          className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 placeholder:text-[var(--muted)] max-h-32"
          disabled={isProcessing}
          onKeyDown={handleKeyDown}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question or describe a record…"
          rows={2}
          value={input}
        />
        <button
          aria-label="Send"
          className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white transition hover:opacity-90 disabled:opacity-50"
          disabled={!input.trim() || isProcessing}
          onClick={handleSend}
          type="button"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
