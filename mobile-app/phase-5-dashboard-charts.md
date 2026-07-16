# Phase 5 — Dashboard & chart readability (R5)

Pages: `dashboard-page.tsx`, chart sections of `transactions-summary-page.tsx` and
`inventory-summary-page.tsx`.

> **Good news:** every `recharts` chart already uses
> `ResponsiveContainer width="100%"`, so **nothing overflows the page** — this phase is
> pure readability, not layout breakage. Low priority; ship after 0–4.

## The two recurring problems

1. **Fixed `YAxis width={N}`** eats horizontal space. On a 375px chart a `width={140}`
   category axis leaves only ~200px for bars.
2. **`XAxis interval={0}`** forces every tick label, which overlaps on narrow screens.

There's no per-breakpoint prop in recharts JSX, so gate on a width check. Simplest:
a `useMediaQuery('(max-width: 640px)')` boolean (or `window.innerWidth < 640` read
once on mount) and feed smaller values on mobile. One tiny hook, reused across charts.

```jsx
const isMobile = useMediaQuery('(max-width: 640px)')  // trivial hook, ~5 lines
…
<YAxis width={isMobile ? 72 : 140} />
<XAxis interval={isMobile ? 'preserveStartEnd' : 0} />
```

## dashboard-page.tsx

| Chart | Line | Change |
|-------|------|--------|
| Category Breakdown (vertical bars) | `YAxis width={140}` (`:543`) | `width={isMobile ? 72 : 140}`; long category labels — also consider `tickFormatter` to truncate |
| Top Customers (bars) | `XAxis interval={0}` (`:594`) | `interval={isMobile ? 'preserveStartEnd' : 0}` so names don't overlap |
| Daily / Monthly | `YAxis width={44}` (`:415, :648`) | fine as-is |

- KPI grids (`:261, :373, :447`) and recent-activity (`:789`) already responsive. Low-stock
  table (`:726`) already scrolls. No layout work.

## transactions-summary-page.tsx

- Category horizontal bars `YAxis width={100}` (`:1026`) → `isMobile ? 64 : 100`.
- Other `YAxis width={52}` are fine.
- Chart grids `lg:grid-cols-2` stack on mobile already.

## inventory-summary-page.tsx

- Per-item vertical bar `YAxis width={90}` (`:791`) → `isMobile ? 60 : 90`.
- Fixed chart `height={240}` (`:768, :787, :805`) is fine on mobile (height, not width).

## Skipped

- Making chart **heights** responsive — not needed; fixed heights read fine on mobile.
- A charting-config abstraction — YAGNI, three one-line `isMobile ?` swaps.

## Done when

Category/customer charts are legible at 375px (axis labels not overlapping, bars have
room). No page overflow (there wasn't any). Desktop charts unchanged.
