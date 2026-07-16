# Phase 2 — Transactions cluster (polish)

Pages: `transactions-page.tsx`, `transactions-summary-page.tsx`,
`transaction-detail-page.tsx`, `categories-page.tsx`, `income-share-page.tsx`.

> Assumes Phase 1 already fixed search inputs, modal grid pairs, and income-share
> headers. This doc is the page-specific work that's left.

## transactions-page.tsx (2902 lines — the big one)

- **List table is already responsive** (mobile card `:1845-1917` / desktop grid
  `:1919-1980`, sticky actions, all px `sm:`-gated). **No layout work.** This is the
  reference for R6 elsewhere.
- **Line-items row in the transaction modal** (`:2677-2809`) — the real mobile risk.
  It's a `flex items-start gap-2` with hardcoded child widths: `style={{width:'11rem'}}`
  (`:2638, :2692, :2765`), `w-16` (`:2767`), `w-24` (`:2640, :2789`), `w-12` (`:2718`).
  Sum of fixed widths + flexible item-name overflows a 375px modal.
  - Fix: below `sm`, stack the row — `flex flex-col gap-2 sm:flex-row sm:items-start`
    and drop the fixed widths to `w-full sm:w-24` etc. Or (leaner) wrap the row in
    `overflow-x-auto` so it scrolls within the modal. Prefer stacking for a form.
- Toolbar row `:1695` — Phase 1 makes it wrap; also add `sm:flex-row` so the date
  button and search/filter group stack cleanly at 375px.

## transactions-summary-page.tsx

- KPI/chart grids all already responsive (`:588, :807, :880, :990`). No work.
- Three tables (`:664, :1060, :1143`) have **no `min-w`** → cramped numeric columns.
  Add `min-w-[560px]` per Phase 1b, or card-stack the "Monthly breakdown" if it reads
  poorly.
- Charts: see Phase 5 (YAxis `width={100}` at `:1026`, `width={52}` elsewhere).

## transaction-detail-page.tsx

- Page is otherwise clean. Table `min-w-[640px]` at `:423` already scrolls (Phase 1b
  edge-bleed optional). Modal qty/cost pair `:566` handled in Phase 1d.
- Nothing else.

## categories-page.tsx

- Div-based rows, mostly fine. One thing: the type-header toggle button (`:210-216`)
  packs icon + code + `— {label}` + count badge + chevron in a non-wrapping flex with
  **no truncation** on the label span (`:216`). Long type labels push width on 375px.
  - Fix: add `min-w-0` to the button's flex container and `truncate` to the label span.
- Category rows (`:265-309`) already `flex-wrap` — fine. Modals fine.

## income-share-page.tsx

- Headers `:158` / `:253` fixed in Phase 1e.
- Rule modal (`:341-418`) uses **hardcoded light-theme colors** (`bg-white`,
  `text-gray-*`, `bg-blue-600`) — breaks in dark mode. Optional cleanup while here:
  swap to `var(--panel)` / `var(--foreground)` / `var(--accent)` tokens to match the
  rest of the app. Not a responsiveness issue, but you're in the file.
- Monthly percentage input `w-24` (`:289`) is fine (small, inside a `flex-1` row).

## Done when

Transaction modal line-items usable at 375px; category type labels truncate instead
of overflowing; income-share renders correctly in dark mode.
