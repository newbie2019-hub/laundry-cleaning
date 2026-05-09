import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TutorialPlacement, TutorialStep } from './feature-tutorial-types'

type Rect = { top: number; left: number; width: number; height: number }

type Props = {
  step: TutorialStep
  currentIndex: number
  total: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}

const POPOVER_WIDTH = 380
const POPOVER_HEIGHT_ESTIMATE = 240
const SPOTLIGHT_PADDING = 8
const GAP = 12

// Poll the DOM for an element tagged with the given data-tutorial value.
// Unlike the onboarding tour we keep polling indefinitely because tutorial
// anchors often live inside modals the user has yet to open. When the anchor
// disappears (e.g. the user closed a modal) we just fall back to a centered
// popover until they re-open it.
function useAnchorRect(anchor: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    if (!anchor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null)
      return
    }
    let cancelled = false

    function measure(): boolean {
      const el = document.querySelector<HTMLElement>(
        `[data-tutorial="${anchor}"]`,
      )
      if (!el) {
        setRect(null)
        return false
      }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        setRect(null)
        return false
      }
      setRect({ height: r.height, left: r.left, top: r.top, width: r.width })
      return true
    }

    measure()
    const interval = window.setInterval(() => {
      if (cancelled) return
      measure()
    }, 200)

    function update(): void {
      measure()
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor])

  return rect
}

function computePopoverPosition(
  spotlight: Rect,
  placement: TutorialPlacement,
): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const popW = Math.min(POPOVER_WIDTH, vw - 32)
  const popH = POPOVER_HEIGHT_ESTIMATE

  let top = 0
  let left = 0

  switch (placement) {
    case 'top': {
      top = spotlight.top - popH - GAP
      left = spotlight.left + spotlight.width / 2 - popW / 2
      break
    }
    case 'left': {
      top = spotlight.top + spotlight.height / 2 - popH / 2
      left = spotlight.left - popW - GAP
      break
    }
    case 'right': {
      top = spotlight.top + spotlight.height / 2 - popH / 2
      left = spotlight.left + spotlight.width + GAP
      break
    }
    case 'center':
    case 'bottom':
    default: {
      top = spotlight.top + spotlight.height + GAP
      left = spotlight.left + spotlight.width / 2 - popW / 2
      break
    }
  }

  if (top < 16) {
    top = spotlight.top + spotlight.height + GAP
  }
  if (top + popH > vh - 16) {
    top = Math.max(16, spotlight.top - popH - GAP)
  }

  top = Math.max(16, Math.min(vh - popH - 16, top))
  left = Math.max(16, Math.min(vw - popW - 16, left))

  return { left, top, width: popW }
}

// Render the description as paragraphs so the steps that include short
// bulleted lists (separated by `\n- `) wrap nicely. We intentionally avoid a
// markdown lib to keep the bundle small.
function renderDescription(text: string) {
  const blocks = text.split(/\n{2,}/)
  return blocks.map((block, idx) => {
    const lines = block.split('\n')
    const isList = lines.every((l) => l.trim().startsWith('- ') || l.trim() === '')
    if (isList) {
      return (
        <ul
          className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]"
          key={idx}
        >
          {lines
            .filter((l) => l.trim().startsWith('- '))
            .map((l, lIdx) => (
              <li key={lIdx}>{renderInline(l.trim().slice(2))}</li>
            ))}
        </ul>
      )
    }
    // Mixed block: render each newline-separated line as its own paragraph.
    return (
      <div className="space-y-1.5" key={idx}>
        {lines.map((line, lIdx) => {
          const trimmed = line.trim()
          if (trimmed.startsWith('- ')) {
            return (
              <ul
                className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]"
                key={lIdx}
              >
                <li>{renderInline(trimmed.slice(2))}</li>
              </ul>
            )
          }
          return (
            <p
              className="text-sm leading-relaxed text-[var(--muted)]"
              key={lIdx}
            >
              {renderInline(line)}
            </p>
          )
        })}
      </div>
    )
  })
}

// Minimal inline formatter: **bold** and *italic*.
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(
        <strong className="font-semibold text-[var(--foreground)]" key={key++}>
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export function FeatureTutorialOverlay({
  currentIndex,
  onBack,
  onNext,
  onSkip,
  step,
  total,
}: Props) {
  const rect = useAnchorRect(step.anchor)

  const spotlight: Rect | null = rect
    ? {
        height: rect.height + SPOTLIGHT_PADDING * 2,
        left: Math.max(rect.left - SPOTLIGHT_PADDING, 4),
        top: Math.max(rect.top - SPOTLIGHT_PADDING, 4),
        width: rect.width + SPOTLIGHT_PADDING * 2,
      }
    : null

  const popoverStyle: React.CSSProperties = spotlight
    ? computePopoverPosition(spotlight, step.placement)
    : {
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: Math.min(POPOVER_WIDTH, window.innerWidth - 32),
      }

  const isLast = currentIndex + 1 >= total
  const nextLabel = step.nextLabel ?? (isLast ? 'Finish' : 'Next')

  return createPortal(
    // The wrapping container is `pointer-events-none` so clicks pass through
    // the dim backdrop to the page underneath — that's what allows the user to
    // actually click the spotlighted button, open the highlighted modal, etc.
    // Only the popover itself re-enables pointer events so its own controls
    // (Back / Next / Skip) stay interactive.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[2100]"
      role="presentation"
    >
      {spotlight ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-200"
          style={{
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.68)',
            height: spotlight.height,
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-slate-900/70" />
      )}

      <div
        aria-modal="true"
        className="pointer-events-auto absolute z-[2101] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        role="dialog"
        style={popoverStyle}
      >
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Step {currentIndex + 1} of {total}
        </div>
        <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
          {step.title}
        </h3>
        <div className="mt-1.5">{renderDescription(step.description)}</div>
        {step.note ? (
          <p className="mt-3 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-strong,var(--accent))]">
            {renderInline(step.note)}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            className="text-xs font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
            onClick={onSkip}
            type="button"
          >
            Skip tutorial
          </button>
          <div className="flex items-center gap-2">
            {currentIndex > 0 && (
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                onClick={onBack}
                type="button"
              >
                Back
              </button>
            )}
            <button
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              onClick={onNext}
              type="button"
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
