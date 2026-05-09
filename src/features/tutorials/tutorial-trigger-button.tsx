import { HelpCircle } from 'lucide-react'
import { useFeatureTutorial } from './use-feature-tutorial'

type Props = {
  /** Optional label override; defaults adjust based on completion state. */
  label?: string
  /** Render as an icon-only button (default) or with a visible label. */
  variant?: 'icon' | 'labeled'
  className?: string
}

export function TutorialTriggerButton({
  label,
  variant = 'icon',
  className,
}: Props) {
  const { isActive, isCompleted, restart, start } = useFeatureTutorial()

  const tooltip =
    label ?? (isCompleted ? 'Restart tutorial' : 'How to use this page')
  const handleClick = () => {
    if (isActive) return
    if (isCompleted) {
      restart()
    } else {
      start()
    }
  }

  if (variant === 'labeled') {
    return (
      <button
        aria-label={tooltip}
        className={
          className ??
          'inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]'
        }
        disabled={isActive}
        onClick={handleClick}
        title={tooltip}
        type="button"
      >
        <HelpCircle className="h-4 w-4" />
        {isCompleted ? 'Restart tutorial' : 'Tutorial'}
      </button>
    )
  }

  return (
    <button
      aria-label={tooltip}
      className={
        className ??
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40'
      }
      disabled={isActive}
      onClick={handleClick}
      title={tooltip}
      type="button"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  )
}
