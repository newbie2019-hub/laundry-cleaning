import type { TutorialStep } from './feature-tutorial-types'

// Walkthrough of the Transactions page (/transactions).
//
// Transactions are the central record of every sale, expense, cash advance,
// and operating cost. The form is the most complex in the app because it
// adapts based on type/category (loads, customers, line items, templates),
// so the tutorial walks through every relevant section in order.
export const TRANSACTION_TUTORIAL_STEPS: TutorialStep[] = [
  {
    anchor: null,
    description:
      "**Transactions** are the heart of your records — every sale, expense, operating cost, and staff cash advance lives here. The summary at the top of the page reflects the totals for whichever period you're viewing.\n\nThis tutorial walks through the page, then opens the **New transaction** form so you can see what each field controls.\n\n**Important:** if you want a sale to deduct stock from inventory automatically, the items must already exist in **Inventory** (and optionally inside a **Sale Template** for one-click bundles).",
    id: 'welcome',
    placement: 'center',
    title: 'Welcome to Transactions',
  },
  {
    anchor: 'tutorial-tx-summary',
    description:
      "These four cards summarize the currently selected period:\n- **Total Sales** — money received from customer sales\n- **Expenses** — direct expenses (purchases, refunds, etc.)\n- **Operating Exp.** — recurring overhead (rent, utilities, salaries)\n- **Net Income** — Sales − all expenses\n\nWhen comparison data is available you'll also see a **vs yesterday** delta with an up/down arrow next to each value.",
    id: 'summary',
    placement: 'bottom',
    title: 'Period summary',
  },
  {
    anchor: 'tutorial-tx-table',
    description:
      "Every transaction is listed here, newest first by default. Click any **column header** to change the sort.\n\nClick a row to open the **transaction detail page**, which shows the full breakdown: line items, linked inventory movements, customer info, and any cash advance link.\n\nThe pencil and trash icons let you edit or delete a transaction inline (subject to your permissions).",
    id: 'table',
    placement: 'top',
    title: 'Transaction list',
  },
  {
    anchor: 'tutorial-add-tx-btn',
    description:
      "Click **New transaction** to record a sale, expense, operating cost, or cash advance. The form opens in a dialog — every field is explained in the next steps.",
    id: 'add-btn',
    nextLabel: "I've opened the form",
    note: 'Click the highlighted **New transaction** button, then continue.',
    placement: 'left',
    title: 'Add a transaction',
  },
  {
    anchor: 'tutorial-tx-date',
    description:
      "The date the transaction occurred — defaults to **today**.\n\nAccurate dates matter because monthly summaries, income share calculations, and the period filters at the top of the page all bucket transactions by this date. Backdating is allowed when you forgot to record a sale earlier.",
    id: 'date',
    placement: 'right',
    title: 'Date',
  },
  {
    anchor: 'tutorial-tx-type',
    description:
      "Pick the kind of transaction. Common options:\n- **SALE** — revenue from a customer\n- **EXPENSE** — money spent (supplies, refunds)\n- **OPERATING EXPENSE** — recurring costs (rent, utilities, salaries)\n\nThe type controls which **categories** become available in the next field, and which extra fields show up — for example loads + customers only appear on SALE.",
    id: 'type',
    placement: 'right',
    title: 'Transaction type',
  },
  {
    anchor: 'tutorial-tx-category',
    description:
      "Categories drill down within a type. For example a **SALE** can be *Laundry Service*, *Refreshments*, or *Equipment Rental*; an **EXPENSE** can be *Detergent Restock* or *Repair*; an **OPERATING EXPENSE** can be *Electricity* or *Salaries*.\n\nCategories drive the breakdown charts on the **Summary** page and let you filter the transaction list. Manage them under **Transactions → Categories** in the sidebar.\n\nSome categories (like *Cash Advance*) reveal additional fields below — e.g. a staff selector.",
    id: 'category',
    placement: 'right',
    title: 'Category',
  },
  {
    anchor: 'tutorial-tx-template',
    description:
      "If you've created **Sale Templates** under *Inventory → Sale templates*, this is where you apply one. Pick a template and the inventory line items, quantities, prices, and the **Amount** auto-fill from the bundle.\n\nA preview table appears below the picker so you can adjust per-line quantities before saving — for example to scale a *Standard Package* to a *Double* by tweaking quantities.\n\nThis section only appears for **SALE** transactions and only if you can manage inventory. Templates are optional — skip if you'd rather add line items manually.",
    id: 'template',
    placement: 'right',
    title: 'Sale template (optional)',
  },
  {
    anchor: 'tutorial-tx-customer',
    description:
      "Optionally link this sale to a **customer**. Doing so:\n- Builds a per-customer purchase history (visible on the customer detail page)\n- Counts toward **loyalty rewards** (free loads after N paid loads, configurable in Settings)\n- Lets you filter the transaction list by customer\n\nLeave blank for walk-in or anonymous sales. The field only appears on transaction types that involve a customer (typically SALE).",
    id: 'customer',
    placement: 'right',
    title: 'Customer',
  },
  {
    anchor: 'tutorial-tx-amount',
    description:
      "The **total** amount of the transaction in your store currency.\n\nWhen you apply a sale template or add line items below, the amount **auto-calculates** from the line totals — but you can override it manually at any time (useful for ad-hoc discounts or rounding).\n\nFor a redeemed loyalty reward (free load), the amount is locked at **0** automatically.",
    id: 'amount',
    placement: 'right',
    title: 'Amount',
  },
  {
    anchor: 'tutorial-tx-line-items',
    description:
      "Add itemized line items beyond the base amount. Each line can be:\n- An **inventory item** picked from the suggestions list — saving the transaction creates a matching **stock-OUT movement** automatically, keeping inventory counts accurate without manual entry\n- A **custom label** typed in freely — useful for one-off charges like *Surcharge* or *Tip*\n\nFor each line set the **quantity**, **sale unit** (base unit or an alt unit you defined on the inventory item), and **unit price** (defaults to the item's selling price).\n\nThe footer shows *Base + Items = Total* so you always see how the amount is built up.",
    id: 'line-items',
    placement: 'top',
    title: 'Additional line items',
  },
  {
    anchor: 'tutorial-tx-description',
    description:
      "Free-text notes attached to this transaction — reference numbers, customer instructions, or any context staff should see.\n\nThis text is searchable from the toolbar's search box and appears on the transaction detail page.",
    id: 'description',
    placement: 'right',
    title: 'Description',
  },
  {
    anchor: null,
    description:
      "Click **Save** at the bottom of the form. Your transaction appears in the list immediately, the period summary cards update, and any inventory line items trigger automatic **stock-OUT movements** linked back to this transaction.\n\nClick the saved row to open its detail page and review:\n- Line item breakdown\n- Linked inventory movements (you can also add more there)\n- Customer link and loyalty progress (for sales)\n\nReplay this tutorial any time from the **?** icon next to the page header.",
    id: 'finish',
    placement: 'center',
    title: "You're ready to record transactions",
  },
]
