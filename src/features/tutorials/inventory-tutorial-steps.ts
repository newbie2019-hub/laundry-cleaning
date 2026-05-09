import type { TutorialStep } from './feature-tutorial-types'

// Step-by-step walkthrough of the Inventory page. Anchors map to the
// `data-tutorial="..."` attributes added inside `inventory-page.tsx`.
//
// The flow is intentionally split into two phases:
//   1. The page itself (stats, table, toolbar) — visible immediately.
//   2. The Add/Edit item modal — the user is asked to open it, then each
//      field gets its own descriptive step.
export const INVENTORY_TUTORIAL_STEPS: TutorialStep[] = [
  {
    anchor: null,
    description:
      "This is your **Inventory** — the master list of every product, ingredient, material, or piece of equipment you track for this business.\n\nWhy it matters: items must be added here **before** you can record inventory-linked sales or expenses on the Transactions page. Sale templates also pull from this list.\n\nThis tutorial walks you through every section, then opens the Add Item form so you can see what each field does.",
    id: 'welcome',
    placement: 'center',
    title: 'Welcome to Inventory',
  },
  {
    anchor: 'tutorial-inventory-stats',
    description:
      "These four cards summarize your inventory at a glance:\n- **Total Items** — how many items are registered (with active count)\n- **Low Stock** — items at or below their minimum threshold; need restocking\n- **Equipment** — count of equipment items and how many need attention (under maintenance, out of service)\n- **Total Value** — the combined cost value of all stock on hand (cost per unit × current stock)\n\nThey update automatically whenever you add, edit, or move stock.",
    id: 'stats',
    placement: 'bottom',
    title: 'Inventory at a glance',
  },
  {
    anchor: 'tutorial-inventory-toolbar',
    description:
      "Use the search box to find items by **name**, **description**, or **supplier**. Type a few letters and the table filters live.\n\nThe **Filters** button opens a dialog with advanced filters — by category, stock status (in stock / low / out), and a toggle to include inactive items. A badge on the button shows how many filters are currently active.\n\nThe **Backup** button lets you export your inventory to a JSON file (useful before bulk edits) and re-import it later.",
    id: 'toolbar',
    placement: 'bottom',
    title: 'Search, filter, and back up',
  },
  {
    anchor: 'tutorial-inventory-table',
    description:
      "Every item registered for this business shows up here.\n\n- Click any **column header** to sort by that field (click again to reverse).\n- Click an **item row** to view its full stock movement history.\n- The action icons on the right let you **stock in** (restock), **stock out** (use / sell), or **edit** the item without leaving the page. Equipment items show a **wrench** icon for service / maintenance entries instead.\n- Items below their minimum threshold are flagged with a red **LOW** tag.",
    id: 'table',
    placement: 'top',
    title: 'The items table',
  },
  {
    anchor: 'tutorial-add-item-btn',
    description:
      "Click **Add Item** to register a new product. The form opens in a dialog with several fields — we'll walk through each one in the next steps.",
    id: 'add-item-btn',
    nextLabel: "I've opened the form",
    note: 'Click the highlighted **Add Item** button to open the form, then continue.',
    placement: 'bottom',
    title: 'Add a new item',
  },
  {
    anchor: 'tutorial-item-name',
    description:
      "Give the item a clear, specific name — for example *Coca-Cola 1.5L* instead of just *Coke*, or *Bleach 5L Drum* instead of *Bleach*.\n\nThis name appears everywhere: the inventory list, transaction line items, sale templates, and reports. Specific names make it easier for staff to pick the correct item when recording sales.",
    id: 'name',
    placement: 'right',
    title: 'Item name',
  },
  {
    anchor: 'tutorial-item-category',
    description:
      "Categories group related items together — for example *Beverages*, *Cleaning Supplies*, *Detergent & Chemicals*, *Equipment*.\n\nThey power the category filter on this page and category-level breakdowns in the inventory summary report. You can manage categories under **Inventory → Categories** in the sidebar.\n\nNote: choosing **Equipment** unlocks the **Status** and **Last Maintenance** fields further down.",
    id: 'category',
    placement: 'left',
    title: 'Category',
  },
  {
    anchor: 'tutorial-item-unit-type',
    description:
      "Pick how this item is measured. Each option changes how quantities and prices are interpreted:\n- **Per piece** — countable units (bottles, packs)\n- **Liquid** — measured in ml, L, gal, etc.\n- **Weight** — measured in g or kg\n- **Length** — measured in m or cm\n- **Pack / Bundle** — sold by box, case, or set\n- **Other** — anything custom\n\nLiquid, weight, and length items can have **fractional** quantities (e.g. 1.5 L). Per-piece items use whole numbers.",
    id: 'unit-type',
    placement: 'right',
    title: 'Unit type',
  },
  {
    anchor: 'tutorial-item-unit-label',
    description:
      "The short label shown next to quantities throughout the app — for example *bottle*, *sack*, *roll*, *L*, or *kg*.\n\nKeep it short and recognizable for staff. For liquid items, common units (ml, L, gal, fl oz) are suggested in the dropdown so the system can auto-convert smaller selling units (next step).",
    id: 'unit-label',
    placement: 'left',
    title: 'Unit label',
  },
  {
    anchor: 'tutorial-item-cost',
    description:
      "The purchase or production cost for one unit of the base unit type.\n\nThis figure powers the **Total Value** KPI card and the cost of goods sold in reports. It is **internal** — it never appears on customer receipts. Keep it up to date when supplier prices change so your margin calculations stay accurate.",
    id: 'cost',
    placement: 'right',
    title: 'Cost per unit',
  },
  {
    anchor: 'tutorial-item-price',
    description:
      "The default price charged to customers per unit. When you add this item to a transaction or sale template, the price field **pre-fills** with this value.\n\nYou can always override the price for a specific sale — this is just the suggested starting point. Leave blank if the item is not directly resold (e.g. an internal-use supply).",
    id: 'price',
    placement: 'left',
    title: 'Selling price',
  },
  {
    anchor: 'tutorial-item-alt-units',
    description:
      "If you sell or buy this item in a different size than its base unit, add a smaller selling unit here. Stock stays in the **base** unit; sales are converted automatically.\n\nEach row needs:\n- **Unit name** — e.g. *cup*, *sachet*, *250ml*\n- **Per base** — how many of this smaller unit fit in one base unit (e.g. 31 cups per gallon)\n- **Default price** — optional override for this unit's selling price\n\nExample: a 1-gallon detergent that you also sell by the cup. Set Cup = 31 per gallon at ₱15 each, and a 1-cup sale will deduct ~0.032 gal from stock automatically.",
    id: 'alt-units',
    placement: 'left',
    title: 'Smaller selling units (optional)',
  },
  {
    anchor: 'tutorial-item-threshold',
    description:
      "When current stock drops to or below this number, the item is flagged as **Low Stock** and counted in the Low Stock KPI card.\n\nUse it as a restock alert. Set a higher threshold for fast-moving items, lower for rare ones. Set to **0** to disable low-stock alerts for this item.",
    id: 'threshold',
    placement: 'right',
    title: 'Minimum stock threshold',
  },
  {
    anchor: 'tutorial-item-supplier',
    description:
      "Optional. Record who you buy this item from — e.g. the supplier name, store, or distributor.\n\nIt's purely informational right now (used for searching and as a reference when you need to restock), but it keeps your purchasing knowledge in one place instead of in someone's head.",
    id: 'supplier',
    placement: 'right',
    title: 'Supplier',
  },
  {
    anchor: 'tutorial-item-initial-stock',
    description:
      "**For new items only.** Enter the quantity you currently have on hand right now.\n\nWhen you save the item, the system automatically creates an opening **stock-IN movement** dated today, so your stock history is accurate from day one. After this, further restocks and consumption are recorded under **Inventory → Movements** (or via the quick stock-in / stock-out icons on the items table).",
    id: 'initial-stock',
    placement: 'right',
    title: 'Initial stock',
  },
  {
    anchor: null,
    description:
      "Click **Add Item** at the bottom of the form to save. Your new item now appears in the inventory table and can be selected on the Transactions page and inside Sale Templates.\n\nNext recommended steps:\n- Add **Sale Templates** if you sell bundles of items together (Inventory → Sale templates)\n- Try recording a sale on the **Transactions** page that uses this item — its stock will be deducted automatically\n\nYou can replay this tutorial any time by clicking the **?** icon next to the toolbar.",
    id: 'finish',
    placement: 'center',
    title: "You're ready to manage inventory",
  },
]
