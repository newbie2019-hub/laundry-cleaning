import { Bot, User } from 'lucide-react'
import type { AssistantMessage } from '../types'
import { PreviewCard } from './preview-card'
import { useAssistant } from '../use-assistant'

type Props = {
  message: AssistantMessage
}

function renderText(text: string) {
  // Render **bold** and bullet points with some basic formatting
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const boldLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    return (
      <span key={i} dangerouslySetInnerHTML={{ __html: boldLine + (i < lines.length - 1 ? '<br/>' : '') }} />
    )
  })
}

export function MessageBubble({ message }: Props) {
  const { confirmCreate, cancelCreate } = useAssistant()
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-1 ${
        isUser
          ? 'bg-[var(--accent)] text-white'
          : 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
      }`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Text bubble */}
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-tr-sm bg-[var(--accent)] text-white'
            : 'rounded-tl-sm bg-[var(--panel)] border border-[var(--border)] text-[var(--foreground)]'
        }`}>
          {message.text === '…' ? (
            <span className="flex gap-1 items-center py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
            </span>
          ) : (
            <p className="whitespace-pre-wrap">{renderText(message.text)}</p>
          )}
        </div>

        {/* Preview card */}
        {message.preview && (
          <PreviewCard
            preview={message.preview}
            onConfirm={() => void confirmCreate(message.preview!, message.id)}
            onCancel={() => cancelCreate(message.id)}
          />
        )}

        {/* Parser label */}
        {message.parserUsed && (
          <span className="text-[10px] text-[var(--muted)] px-1">
            via {message.parserUsed === 'cloud' ? 'AI' : 'local parser'}
          </span>
        )}
      </div>
    </div>
  )
}
