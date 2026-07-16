# Phase 6 — Admin pages (polish)

Pages: `settings-page.tsx`, `users-page.tsx`, `incident-reports-page.tsx`,
`exports-page.tsx`. Plus a note on the already-safe auth pages.

## settings-page.tsx (1403 lines)

**Already the most mobile-ready page.** The repeating label|control rows use
`grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-[280px_1fr]` (`:477, 516, 602, 802,
903, 985, 1053, 1105, 1136, 1233, 1261`) — all stack to one column below `md`. Control
widths are `max-w-[480px]` (a max, shrinks fine). Forms are single-column `space-y-4`.

- **Only thing to check:** the theme-button row `flex gap-2` (`:489`) with three
  `px-4 py-2.5` buttons — verify it doesn't overflow at 375px. If tight, add `flex-wrap`.
- Reset dialog (`:1296`) is `max-w-md` + `p-4` — fits.
- No tables, no search. Essentially done.

## users-page.tsx

- Users **list** is a CSS grid, already responsive: `grid-cols-[1fr_auto]
  sm:grid-cols-[2fr_1fr_1fr_auto]` (`:179`) with Roles/Status `hidden sm:block`
  (`:181/182, 206, 222`) — mobile shows User + Edit only. Good, no overflow.
- Role-**permissions** table (`:272`) is `min-w-full` inside `overflow-x-auto` (`:271`) —
  scrolls as roles grow. Fine (edge-bleed optional per Phase 1b).
- Form fields `sm:grid-cols-2` (`:341`), role checkboxes `sm:grid-cols-2` (`:376`) — stack
  on mobile. Slide-over `max-w-md` (`:321`). No work.

## incident-reports-page.tsx

- Search+filter row `w-64` + no-wrap **fixed in Phase 1c** (`:512/516`).
- Table is a wide CSS-grid (`TABLE_GRID` `:213`, `min-w-[1200px]` `:548`, 9 cols) inside
  `overflow-x-auto` (`:547`) — scrolls. Fine; edge-bleed optional.
- Details dialog `sm:grid-cols-2` (`:755`) already stacks. Filter/form date & input pairs
  `grid-cols-2` at `:912, 1050, 1104, 1155` — **stacked in Phase 1d**.
- New/edit side sheet `max-w-md` full-height (`:1026`) — on mobile `w-full`, fine.
- No page-specific work beyond Phase 1.

## exports-page.tsx

- Card grid `grid-cols-1 lg:grid-cols-2` (`:94`) — single column on mobile. Card inner
  `flex flex-wrap items-center justify-between gap-3` (`:150`) — Export button drops below
  on narrow. Good.
- **Check the imported components** not in this file: `DateRangeFields` and `MonthPicker`
  (imports at `:5, :7`) may have side-by-side/fixed-width date inputs. Open them and apply
  R3 (`grid-cols-1 sm:grid-cols-2`) if needed. `ColumnSelectDialog` likewise.
- No in-file work.

## Auth pages — no work

`login-page.tsx` and `select-business-page.tsx` are already mobile-safe (centered
`max-w-sm`/`max-w-3xl`, `grid-cols-1 sm:grid-cols-2` cards, full-width fields). Skip.

## Done when

Settings theme buttons verified; exports' shared date/column components checked and fixed
if needed. Everything else here was already handled by Phase 1.
