// Shared types for the per-feature tutorial system.
//
// Unlike the onboarding tour (`src/features/onboarding/`), feature tutorials
// are scoped to a single page or workflow, are user-triggered (no auto-start),
// and use the `data-tutorial="..."` attribute for anchoring.

export type TutorialPlacement = 'center' | 'top' | 'bottom' | 'left' | 'right'

export type TutorialStep = {
  id: string
  title: string
  description: string
  // data-tutorial value of the DOM element to spotlight; null = centered.
  anchor: string | null
  placement: TutorialPlacement
  // Optional helper hint shown below the description in muted styling.
  // Useful for guidance like "Open the form first to see this field".
  note?: string
  // Optional custom label for the Next button.
  nextLabel?: string
}
