const inputClass =
  'h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30'

export function DateRangeFields({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        From
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        To
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className={inputClass}
        />
      </label>
    </div>
  )
}
