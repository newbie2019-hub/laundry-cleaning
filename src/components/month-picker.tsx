import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel } from '../lib/format'

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function MonthPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (monthKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => Number(value.slice(0, 4)))
  const ref = useRef<HTMLDivElement>(null)

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const selectedYear = Number(value.slice(0, 4))
  const selectedMonthIndex = Number(value.slice(5, 7)) - 1

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleOpen() {
    setPickerYear(selectedYear)
    setOpen((prev) => !prev)
  }

  function selectMonth(monthIndex: number) {
    const key = `${pickerYear}-${String(monthIndex + 1).padStart(2, '0')}`
    onChange(key)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex h-10 w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm outline-none transition hover:border-[var(--accent)] focus:border-[var(--accent)]"
        onClick={handleOpen}
        type="button"
      >
        <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 truncate text-left">{formatMonthLabel(value)}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-[60] mt-2 w-full min-w-[16rem] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl sm:left-auto sm:right-0 sm:w-64">
          <div className="mb-3 flex items-center justify-between">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              onClick={() => setPickerYear((y) => y - 1)}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">{pickerYear}</span>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-30"
              disabled={pickerYear >= currentYear}
              onClick={() => setPickerYear((y) => y + 1)}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_LABELS.map((label, index) => {
              const isFuture = pickerYear === currentYear && index > currentMonth
              const isSelected = pickerYear === selectedYear && index === selectedMonthIndex
              return (
                <button
                  key={label}
                  className={`rounded-md py-2 text-xs font-medium transition ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white'
                      : isFuture
                        ? 'pointer-events-none text-[var(--muted)]/40 opacity-30'
                        : 'text-[var(--foreground)] hover:bg-[var(--background)]'
                  }`}
                  disabled={isFuture}
                  onClick={() => selectMonth(index)}
                  type="button"
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
