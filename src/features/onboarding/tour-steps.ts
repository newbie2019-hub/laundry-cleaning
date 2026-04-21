// Defines the ordered steps shown during the onboarding tour.
//
// Each step is either centered (anchor = null) or points at a DOM element
// tagged with `data-tour="<anchor>"`. Applicability is evaluated at runtime so
// non-admin users automatically skip steps that only make sense for admins
// (business selection / switching).
import { BUSINESS_LIST } from '../../lib/db/business'

export type TourPlacement = 'center' | 'top' | 'bottom' | 'left' | 'right'

export type TourStepContext = {
  canSwitchBusiness: boolean
  hasSelectedBusiness: boolean
}

export type TourStep = {
  id: string
  title: string
  description: string
  // data-tour value on the DOM element to spotlight; null = centered overlay.
  anchor: string | null
  placement: TourPlacement
  // Whether this step is part of the flow for the current user/session.
  applicable: (ctx: TourStepContext) => boolean
  // Optional custom label for the Next button.
  nextLabel?: string
}

const businessList = BUSINESS_LIST.map((b) => b.name).join(' and ')
const firstBusinessName = BUSINESS_LIST[0]?.name ?? 'the first business'

export const TOUR_STEPS: TourStep[] = [
  {
    anchor: null,
    applicable: () => true,
    description:
      "Let's take 30 seconds to show you around. You can replay this tour any time from the Help button in the sidebar.",
    id: 'welcome',
    placement: 'center',
    title: 'Welcome to Business Manager',
  },
  {
    anchor: 'business-card',
    applicable: (ctx) => ctx.canSwitchBusiness && !ctx.hasSelectedBusiness,
    description: `You'll work with two separate businesses: ${businessList}. Each one keeps its customers, transactions, inventory, and settings in its own isolated database — nothing crosses over. When you're ready, click Next and we'll open ${firstBusinessName} so you can keep exploring.`,
    id: 'select-business',
    nextLabel: `Continue with ${firstBusinessName}`,
    placement: 'bottom',
    title: 'Two businesses, one app',
  },
  {
    anchor: 'sidebar-nav',
    applicable: (ctx) => ctx.hasSelectedBusiness,
    description:
      'Dashboard, Transactions, Inventory, Staff, Customers — everything lives in the sidebar. Expandable sections reveal related tools like Summary and Categories.',
    id: 'sidebar-nav',
    placement: 'right',
    title: 'Navigate from the sidebar',
  },
  {
    anchor: 'business-switcher',
    applicable: (ctx) => ctx.canSwitchBusiness && ctx.hasSelectedBusiness,
    description:
      'The active business is shown at the bottom of the sidebar. Click Switch to jump to the other business any time — your data stays safely isolated in its own database.',
    id: 'business-switcher',
    placement: 'right',
    title: 'Switch businesses anytime',
  },
  {
    anchor: null,
    applicable: () => true,
    description:
      "That's the quick tour. You can restart it any time from the Help button in the sidebar.",
    id: 'finish',
    placement: 'center',
    title: "You're all set",
  },
]
