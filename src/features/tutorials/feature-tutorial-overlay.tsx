import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
// Initial guess used before the popover ref measures its real height. The
// real height is read with a ResizeObserver and fed back into the position
// calculation so flip-to-top works correctly even for long descriptions.
const POPOVER_HEIGHT_ESTIMATE = 320
const SPOTLIGHT_PADDING = 8
const GAP = 12
const VIEWPORT_MARGIN = 16

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
  popHeight: number,
): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const popW = Math.min(POPOVER_WIDTH, vw - VIEWPORT_MARGIN * 2)
  // Cap height so we never need a popover taller than the viewport — its
  // content scrolls internally instead.
  const popH = Math.min(popHeight, vh - VIEWPORT_MARGIN * 2)

  // Space available on each side of the spotlight when placed at that side.
  const spaceTop = spotlight.top - GAP
  const spaceBottom = vh - (spotlight.top + spotlight.height) - GAP
  const spaceLeft = spotlight.left - GAP
  const spaceRight = vw - (spotlight.left + spotlight.width) - GAP

  // Pick the actual side. Honour the requested placement when it fits;
  // otherwise flip to the side with the most room. This is what fixes the
  // case where a `right` step near the bottom of the modal pushes the
  // popover off-screen.
  let actual: TutorialPlacement = placement
  const fits = (p: TutorialPlacement): boolean => {
    switch (p) {
      case 'top':
        return spaceTop >= popH
      case 'bottom':
        return spaceBottom >= popH
      case 'left':
        return spaceLeft >= popW
      case 'right':
        return spaceRight >= popW
      case 'center':
      default:
        return true
    }
  }
  if (placement !== 'center' && !fits(placement)) {
    const candidates: { side: TutorialPlacement; space: number }[] = [
      { side: 'bottom', space: spaceBottom - popH },
      { side: 'top', space: spaceTop - popH },
      { side: 'right', space: spaceRight - popW },
      { side: 'left', space: spaceLeft - popW },
    ]
    candidates.sort((a, b) => b.space - a.space)
    actual = candidates[0]?.side ?? placement
  }

  let top = 0
  let left = 0

  switch (actual) {
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

  // Final clamp inside the viewport.
  top = Math.max(VIEWPORT_MARGIN, Math.min(vh - popH - VIEWPORT_MARGIN, top))
  left = Math.max(VIEWPORT_MARGIN, Math.min(vw - popW - VIEWPORT_MARGIN, left))

  return {
    left,
    maxHeight: vh - VIEWPORT_MARGIN * 2,
    top,
    width: popW,
  }
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
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popHeight, setPopHeight] = useState<number>(POPOVER_HEIGHT_ESTIMATE)

  // Re-measure the popover whenever the step changes, so the position
  // calculation uses the actual rendered height (long descriptions push
  // height past 400+ px which the static estimate could not handle).
  useLayoutEffect(() => {
    const el = popoverRef.current
    if (!el) return
    const update = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) setPopHeight(h)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [step.id])

  // Keyboard navigation: ← back, → next, Enter next, Esc skip. Ignore key
  // presses that originate inside form controls so the user can still type
  // and use arrow keys inside inputs/selects/textareas without accidentally
  // advancing the tutorial.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isFormControl =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable === true
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
        return
      }
      if (isFormControl) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        onNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onBack, onNext, onSkip])

  const spotlight: Rect | null = rect
    ? {
        height: rect.height + SPOTLIGHT_PADDING * 2,
        left: Math.max(rect.left - SPOTLIGHT_PADDING, 4),
        top: Math.max(rect.top - SPOTLIGHT_PADDING, 4),
        width: rect.width + SPOTLIGHT_PADDING * 2,
      }
    : null

  const popoverStyle: React.CSSProperties = spotlight
    ? computePopoverPosition(spotlight, step.placement, popHeight)
    : {
        left: '50%',
        maxHeight: window.innerHeight - VIEWPORT_MARGIN * 2,
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
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
        className="pointer-events-auto absolute z-[2101] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        ref={popoverRef}
        role="dialog"
        style={popoverStyle}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            className="text-xs font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
            onClick={onSkip}
            title="Esc"
            type="button"
          >
            Skip tutorial
          </button>
          <div className="flex items-center gap-2">
            {currentIndex > 0 && (
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                onClick={onBack}
                title="←"
                type="button"
              >
                Back
              </button>
            )}
            <button
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              onClick={onNext}
              title="→"
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
