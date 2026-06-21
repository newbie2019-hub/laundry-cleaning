import { Bot } from 'lucide-react'
import { useAssistant } from '../use-assistant'
import { AssistantPanel } from './assistant-panel'

export function AssistantLauncher() {
  const { isOpen, openAssistant } = useAssistant()

  return (
    <>
      {/* Floating button — only visible when panel is closed */}
      {!isOpen && (
        <button
          aria-label="Open AI Assistant"
          className="fixed bottom-6 right-6 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg transition hover:opacity-90 hover:scale-105 active:scale-95"
          onClick={openAssistant}
          title="AI Assistant"
          type="button"
          style={{ width: 52, height: 52 }}
        >
          <Bot className="h-5 w-5" />
        </button>
      )}

      {/* Panel — rendered inline (not a portal) so it stacks above app content */}
      {isOpen && <AssistantPanel />}
    </>
  )
}
