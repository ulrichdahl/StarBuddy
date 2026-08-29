import type { TFunction } from 'i18next'

/**
 * A stored resource quantity (mSCU for crate goods, pieces for gems) as
 * the user reads it: "1.25 SCU" / "12 pcs", in the active language.
 */
export function formatResourceQuantity(unit: string, quantity: number, t: TFunction, lang: string): string {
  if (unit === 'pieces') return `${quantity.toLocaleString(lang)} ${t('materials.units.pcs')}`
  return `${(quantity / 1000).toLocaleString(lang, { maximumFractionDigits: 3 })} ${t('materials.units.scu')}`
}
