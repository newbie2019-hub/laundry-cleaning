/**
 * Standard liquid unit conversion table, anchored in milliliters.
 *
 * `mlValue` is the amount of milliliters in one of the unit. So
 * `gallon.mlValue / cup.mlValue ≈ 16` means there are 16 cups in 1 gallon.
 *
 * US customary units are used for cup/pint/quart/gallon/fl oz (UK gallon is
 * ~20% larger; we standardize on US for consistency).
 */
export type LiquidUnit = {
  /** Short label stored on `inventory_items.unit_label` / alt unit rows. */
  label: string
  /** Friendly name shown in suggestions and quick-add checkboxes. */
  displayName: string
  /** Milliliters per 1 of this unit. */
  mlValue: number
}

export const LIQUID_UNITS: readonly LiquidUnit[] = [
  { label: 'ml', displayName: 'Milliliter', mlValue: 1 },
  { label: 'cl', displayName: 'Centiliter', mlValue: 10 },
  { label: 'dl', displayName: 'Deciliter', mlValue: 100 },
  { label: 'L', displayName: 'Liter', mlValue: 1000 },
  { label: 'tsp', displayName: 'Teaspoon', mlValue: 4.929 },
  { label: 'tbsp', displayName: 'Tablespoon', mlValue: 14.787 },
  { label: 'fl oz', displayName: 'Fluid Ounce', mlValue: 29.574 },
  { label: 'cup', displayName: 'Cup (US)', mlValue: 236.588 },
  { label: 'pint', displayName: 'Pint (US)', mlValue: 473.176 },
  { label: 'quart', displayName: 'Quart (US)', mlValue: 946.353 },
  { label: 'gallon', displayName: 'Gallon (US)', mlValue: 3785.411 },
] as const

const LIQUID_UNIT_BY_LABEL = new Map<string, LiquidUnit>(
  LIQUID_UNITS.map((u) => [u.label.toLowerCase(), u]),
)

/** Case-insensitive lookup of a known liquid unit. Returns null if unknown. */
export function findLiquidUnit(label: string | null | undefined): LiquidUnit | null {
  if (!label) return null
  const trimmed = label.trim().toLowerCase()
  if (!trimmed) return null
  return LIQUID_UNIT_BY_LABEL.get(trimmed) ?? null
}

/**
 * Returns how many `altLabel` units fit inside one `baseLabel` unit, or null
 * if either label is not in the standard liquid library.
 *
 * Examples:
 *   calcUnitsPerBase('gallon', 'cup') ≈ 16
 *   calcUnitsPerBase('L', 'ml')       === 1000
 */
export function calcUnitsPerBase(
  baseLabel: string | null | undefined,
  altLabel: string | null | undefined,
): number | null {
  const base = findLiquidUnit(baseLabel)
  const alt = findLiquidUnit(altLabel)
  if (!base || !alt) return null
  if (alt.mlValue <= 0) return null
  return base.mlValue / alt.mlValue
}

/** True if the label matches one of our standard liquid units. */
export function isKnownLiquidUnit(label: string | null | undefined): boolean {
  return findLiquidUnit(label) !== null
}
