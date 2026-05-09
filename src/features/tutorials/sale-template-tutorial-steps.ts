import type { TutorialStep } from './feature-tutorial-types'

// Walkthrough of the Sale Templates page (/inventory-templates).
//
// Templates are an *optional* convenience layer on top of inventory:
// they bundle items + quantities + per-bundle prices so a recurring sale
// can be applied to a transaction with one click.
export const SALE_TEMPLATE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    anchor: null,
    description:
      "**Sale Templates** are reusable bundles of inventory items that you sell together regularly — for example *Standard Laundry Package*, *Deep-Cleaning Combo*, or *Refreshment Set*.\n\nInstead of adding line items one by one inside every transaction, you apply a template and the items are pre-filled with the right quantities and prices. Stock-out movements are then created automatically when you save the sale.\n\nTemplates are **completely optional** — you can record sales without them — but they're a huge time saver for repeat sales.\n\n**Important:** items must already exist in **Inventory** before you can include them in a template.",
    id: 'welcome',
    placement: 'center',
    title: 'Welcome to Sale Templates',
  },
  {
    anchor: 'tutorial-templates-list',
    description:
      "All your saved templates appear here. Each row shows the template's name, description, **status** (Active / Inactive), and the number of inventory lines it contains.\n\nFrom the action icons on the right you can:\n- **Pencil** — edit the template's lines, name, description, or active state\n- **Trash** — delete it permanently (a confirm step prevents accidents)\n\nOnly **active** templates show up in the transaction form's template dropdown — perfect for pausing seasonal bundles without losing them.",
    id: 'templates-list',
    placement: 'top',
    title: 'Your saved templates',
  },
  {
    anchor: 'tutorial-create-template-btn',
    description:
      'Click **New template** to create a bundle. The form opens in a side dialog — we\'ll walk through every field next.',
    id: 'create-btn',
    nextLabel: "I've opened the form",
    note: "Click the highlighted **New template** button, then continue.",
    placement: 'left',
    title: 'Create a template',
  },
  {
    anchor: 'tutorial-template-name',
    description:
      "Give the template a clear, descriptive name visible to staff — e.g. *Standard Laundry Package*, *Wash & Fold 8 kg*, or *Deep-Clean Bathroom Bundle*.\n\nThis exact name is what appears in the **Sale template** dropdown on the transactions form, so make it scannable for whoever is recording the sale.",
    id: 'name',
    placement: 'right',
    title: 'Template name',
  },
  {
    anchor: 'tutorial-template-description',
    description:
      "Optional. Use this to record what the bundle includes, when to apply it, or any rules — e.g. *Includes wash, dry, and fold for up to 8 kg. Use for walk-in customers only.*\n\nThis text is shown on the templates list (truncated) so staff can recognise the right bundle without opening it.",
    id: 'description',
    placement: 'right',
    title: 'Description',
  },
  {
    anchor: 'tutorial-template-active',
    description:
      "Controls visibility in the transaction form's template dropdown:\n- **Active** — staff can pick this template when creating a sale\n- **Inactive** — hidden, but the template is preserved for later\n\nUse Inactive to retire seasonal or promotional bundles without deleting their pricing history.",
    id: 'active',
    placement: 'right',
    title: 'Active toggle',
  },
  {
    anchor: 'tutorial-template-lines',
    description:
      "This is the heart of the template — the **inventory lines** that make up the bundle. Add as many as you need; click **+ Add line** for more rows.\n\nFor each line you set:\n- **Item** — pick from your inventory list (must exist already)\n- **Qty** — how many units are sold per bundle (e.g. 1 wash + 2 detergent sachets)\n- **Unit price** — defaults to the inventory item's selling price; override here if the bundle uses a special price\n- **Sale unit** — the inventory's base unit, or one of its smaller alt units (e.g. *cup* for a gallon item)\n\nThe **combo price** at the bottom is the sum of every line — that's the amount that auto-fills when the template is applied to a sale.",
    id: 'lines',
    placement: 'top',
    title: 'Inventory lines',
  },
  {
    anchor: null,
    description:
      "Click **Save** to store the template. It's now available in the **Transactions** form: when you create a sale, pick the template from the **Sale template** dropdown and the line items, quantities, prices, and total amount are filled in for you.\n\nWhen the transaction is saved, each line generates a **stock-OUT** movement automatically, keeping your inventory accurate without extra clicks.\n\nYou can replay this tutorial any time from the **?** icon next to the page header.",
    id: 'finish',
    placement: 'center',
    title: 'Template ready to use',
  },
]
