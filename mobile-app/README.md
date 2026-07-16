# Mobile Responsiveness — Plan Index

> **Goal:** make the app usable on phones (~375px) without regressing the
> desktop (Tauri) experience. Two asks:
> 1. **Sidebar** → burger on mobile, **full-width** panel sliding in from the left.
> 2. **Content** (tables, two-column grids, inputs, search/filter bars) laid out
>    properly at narrow widths.
>
> **App:** Tauri + React 19 + react-router 7 + Tailwind **v4** (config-in-CSS,
> `src/index.css`; there is no `tailwind.config`). Tables are **hand-rolled per
> page** — there is no shared `<Table>` component, so most table fixes are local.
> Icons: `lucide-react`. Charts: `recharts`.

---

## The good news (what already works)

Most page **headers** already use the responsive `flex-col gap-3 sm:flex-row …`
pattern and stack correctly. A mobile top bar + drawer **already exist** in
`src/app/shell/app-shell.tsx` (burger at `:565-573`, drawer at `:591-667`) — the
drawer is just the wrong width (85%) and has no slide animation. And the
**transactions list** (`transactions-page.tsx:1845-1980`) already ships a proper
mobile card / desktop grid split — **use it as the reference pattern** for any
table we choose to card-ify.

So this is mostly a **cleanup + one shell tweak**, not a rewrite.

---

## Breakpoints (Tailwind defaults — do not invent new ones)

| Prefix | Min width | Used for |
|--------|-----------|----------|
| (none) | 0px       | mobile / phone — the base layout |
| `sm:`  | 640px     | large phone / small tablet — where most desktop layouts kick in |
| `lg:`  | 1024px    | **sidebar shows here** (`aside … hidden lg:flex`); below this = drawer |

Note the intentional gap: **640–1024px** (tablet) uses the drawer for nav but
`sm:` desktop layouts for content. That's fine — don't add `md:` steps unless a
page genuinely needs a third arrangement.

---

## Shared recipes (referenced by every phase doc as R1–R6)

These are the whole job. Each page doc just says "apply R1 at line N".

### R1 — Table never clips; scrolls inside its own box
The baseline fix. A wide table must live in a horizontal-scroll container, never
`overflow-hidden`. Let it bleed to the screen edge on mobile so the scroll feels
natural:
```jsx
{/* was: overflow-hidden  →  scroll + edge-bleed on mobile */}
<div className="-mx-4 overflow-x-auto sm:mx-0">
  <table className="w-full min-w-[720px] …">…</table>
</div>
```
- Keep the existing `min-w-[…]` — it's what forces the scroll instead of a squashed table.
- **Bug fixes (clip → scroll):** three tables use `overflow-hidden` and a table with **no wrapper at all** — these are broken today, see Phase 1.
- **Optional premium (R6)** for the highest-traffic tables: stack into cards instead of scrolling.

### R2 — Search input goes fluid
Fixed `w-56`/`w-64` inputs don't shrink and shove the Filters button off-screen:
```jsx
{/* was: w-64  →  full width on mobile, fixed on desktop */}
<input className="h-9 w-full sm:w-64 …" />
```
And ensure the toolbar row wraps: `flex flex-wrap items-center gap-2` (a couple of rows are missing `flex-wrap`).

### R3 — Modal/filter field pairs stack on mobile
`grid grid-cols-2` with no breakpoint keeps two inputs side-by-side at 375px:
```jsx
{/* was: grid grid-cols-2 gap-3  →  stack, then pair */}
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
```
Exception: pairs of *tiny* inputs (min/max numbers, column-visibility checkboxes)
can stay 2-up — they fit. Flagged per page as "optional".

### R4 — Section headers stack
Rows that are `flex items-center justify-between` with a title + controls and **no**
`flex-col`/`sm:` break will crush on mobile:
```jsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
```

### R5 — Chart axis breathing room
`recharts` charts already use `ResponsiveContainer width="100%"` so nothing
overflows the page — but a fixed `YAxis width={140}` or `XAxis interval={0}`
crowds a 375px chart. Reduce axis width and let ticks auto-thin on mobile
(details in Phase 5).

### R6 — (Optional, premium) Card-stack a table on mobile
For the busiest tables, mirror the transactions pattern: render a stacked card
list below `sm` and the grid/table at `sm+`:
```jsx
<div className="sm:hidden">{/* card per row */}</div>
<div className="hidden sm:block overflow-x-auto">{/* table */}</div>
```
Reference implementation: `transactions-page.tsx:1845-1980`. This is more work —
only do it where horizontal scroll is genuinely painful (wide daily-driver tables:
transactions [done], inventory, staff, payroll, customers).

---

## Recommended phase order

| Phase | File | Scope | Effort |
|-------|------|-------|--------|
| **0** | `phase-0-foundation.md` | Shell: burger + full-width slide-in drawer, scroll-lock, Esc. The sidebar ask. | S |
| **1** | `phase-1-global-sweep.md` | Mechanical R1–R4 sweep across **all** pages. Fixes the 3 clipping-table bugs + the no-wrapper table. High leverage, low risk. | M |
| **2** | `phase-2-transactions.md` | Transactions, summary, detail, categories, income-share polish. | M |
| **3** | `phase-3-inventory.md` | 10 inventory pages: line-editor rows, alt-units, breakdown table. | M |
| **4** | `phase-4-people.md` | Staff, staff-detail, payroll, bulk-payroll, customers, customer-detail. Optional R6 card-stacking. | M |
| **5** | `phase-5-dashboard-charts.md` | Dashboard + summary chart readability (R5). | S |
| **6** | `phase-6-admin.md` | Settings, users, incident-reports, exports. | S |

Phases 2–6 assume Phase 1 already did the mechanical fixes; they only cover
page-specific polish. Auth pages (`login`, `select-business`) are **already
mobile-safe** — no work.

---

## Test checklist (every phase)

- [ ] Chrome DevTools device toolbar at **375px** (iPhone SE) and **768px** (iPad).
- [ ] No horizontal scroll on the **page body** (only inside table wrappers).
- [ ] Tap targets ≥ 40px; buttons don't overlap.
- [ ] Drawer opens/closes, closes on nav + backdrop + Esc, locks body scroll.
- [ ] Modals fit within the viewport with `p-4` inset; long forms scroll inside.
- [ ] Light **and** dark theme (some modals still use hardcoded gray — see notes).
- [ ] Desktop (≥1024px) unchanged — diff should be additive `sm:`/`lg:` prefixes.

> **Side note (not responsiveness):** a few modals hardcode light-theme colors
> (`bg-white`, `text-gray-*`) instead of `var(--…)` tokens — inventory movement
> modal and income-share rule modal. Flagged in their phase docs as an optional
> cleanup while you're in the file.
