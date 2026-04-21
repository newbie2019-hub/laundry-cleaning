import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TourPlacement, TourStep } from './tour-steps'

type Rect = { top: number; left: number; width: number; height: number }

type Props = {
  step: TourStep
  currentIndex: number
  total: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}

const POPOVER_WIDTH = 360
const POPOVER_HEIGHT_ESTIMATE = 200
const SPOTLIGHT_PADDING = 8
const GAP = 12

// Poll the DOM for an element tagged with the given data-tour value. The
// element may mount slightly after the step becomes active (e.g. after a
// route transition), so we retry for a few seconds before giving up.
function useAnchorRect(anchor: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useLayoutEffect(() => {
    if (!anchor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null)
      return
    }
    let cancelled = false

    function measure() {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${anchor}"]`,
      )
      if (!el) return false
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return false
      setRect({ height: r.height, left: r.left, top: r.top, width: r.width })
      return true
    }

    if (!measure()) {
      const interval = window.setInterval(() => {
        if (cancelled) return
        if (measure()) window.clearInterval(interval)
      }, 150)
      const timeout = window.setTimeout(() => {
        window.clearInterval(interval)
      }, 5000)
      return () => {
        cancelled = true
        window.clearInterval(interval)
        window.clearTimeout(timeout)
      }
    }

    function update() {
      measure()
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor])

  return rect
}

function computePopoverPosition(
  spotlight: Rect,
  placement: TourPlacement,
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

  // If the chosen side doesn't fit vertically, flip to below.
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

export function TourOverlay({
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
    <div
      aria-live="polite"
      aria-modal="true"
      className="fixed inset-0 z-[2000]"
      role="dialog"
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
        <div className="absolute inset-0 bg-slate-900/70" />
      )}

      <div
        className="absolute z-[2001] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        style={popoverStyle}
      >
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Step {currentIndex + 1} of {total}
        </div>
        <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
          {step.description}
        </p>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            className="text-xs font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
            onClick={onSkip}
            type="button"
          >
            Skip tour
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
