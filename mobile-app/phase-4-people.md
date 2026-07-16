# Phase 4 — Staff, payroll & customers (polish)

Pages: `staff-page.tsx`, `staff-detail-page.tsx`, `payroll-date-page.tsx`,
`bulk-payroll-page.tsx`, `customers-page.tsx`, `customer-detail-page.tsx`.

> These pages have the **widest daily-driver tables** (`min-w` 720–1080px). After
> Phase 1 they scroll horizontally, which is acceptable. This phase is where R6
> (card-stacking) pays off most if you want premium mobile — decide per table.

## staff-page.tsx

- Table `min-w-[960px]` (`:541`), 7 cols + actions — scrolls after Phase 1.
- Modal name/birthdate/emergency fields already `sm:grid-cols-2` (`:700, :745, :785`)
  → stack on mobile. Good.
- KPI cards `grid-cols-2 lg:grid-cols-4` (`:448`) — fine (2-up on mobile).
- **Optional R6:** card-stack the staff list (name + role + status per card, tap → detail).
  Highest value here since staff is browsed on the floor.

## staff-detail-page.tsx

- Payroll table `min-w-[720px]` (`:301`, 8 cols) scrolls. Period cell `font-mono text-xs`
  (`:321`) is a long ISO range — fine inside the scroll.
- Detail `dl` `grid gap-2 sm:grid-cols-2` (`:180`), tab bar `flex-wrap` (`:217`) — good.
- No work beyond Phase 1.

## payroll-date-page.tsx

- **Widest by column count**: `min-w-[960px]`, 10 cols + `tfoot` totals (`:311`). Scrolls.
  This is a dense financial grid — horizontal scroll is the honest choice here; **do not
  card-stack** (the row-level totals matter side-by-side). Just ensure edge-bleed (`-mx-4`).
- Summary cards `grid-cols-2 sm:grid-cols-4` (`:260`) fine. `periodLabel` chip (`:223`)
  wraps as inline text — fine.

## bulk-payroll-page.tsx

- History table `min-w-[480px]` (`:163`, 4 cols) — smallest, fits with minor scroll.
- `PayrollCalendar` child (`:137`) not audited here — **check its grid separately** at
  375px; a month calendar can overflow. If it does, its own fix (scale cells / scroll).
- No in-file work beyond Phase 1.

## customers-page.tsx

- **Widest table in the app**: `min-w-[1080px]`, 7–8 cols (`:642`), double-wrapped
  (`overflow-hidden` outer `:640` + `overflow-x-auto` inner `:641` — it *does* scroll via
  the inner, so not a clip bug, but the outer `overflow-hidden` is redundant; leave it).
  - Note odd column order: Actions (`:651`, `w-32`) sits **before** Date Added. Fix order
    while here if you like, cosmetic.
  - **Optional R6:** best card-stack candidate (name + company + last-transaction per card).
- Summary cards single-column base `sm:grid-cols-2 lg:grid-cols-{3,4}` (`:526/535`) — 1-up
  on mobile. Consider `grid-cols-2` base to match other pages' 2-up density. Optional.
- Filter modal date pairs `:831/858` left 2-up (tiny inputs) per Phase 1d.

## customer-detail-page.tsx

- Transactions table `min-w-[720px]` (`:307`) scrolls; description `max-w-[14rem] truncate`
  (`:345`) fine. Loyalty stats `sm:grid-cols-2 lg:grid-cols-4` (`:255`), stamp row
  `flex-wrap` with `h-11 w-11` stamps (`:231/242`) — all fine. Edit modal single-column. No work.

## Done when

All people/payroll tables scroll (with edge-bleed) at 375px; PayrollCalendar verified;
optionally staff + customers lists card-stack. Desktop unchanged.
