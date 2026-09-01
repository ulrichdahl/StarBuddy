import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api, unwrapList } from '../lib/api'
import { rarityColor } from '../lib/rarity'
import type { CreateResourceStack, Location, ResourceType } from '../lib/types'
import { EntryGridDialog, type EntryGridConfig, type GridRow } from './EntryGridDialog'

/** Materials: catalog-strict picker, per-material bands, SCU or pieces. */
export function MaterialGridDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()

  const config = useMemo<EntryGridConfig<ResourceType>>(() => ({
    title: t('materials.bulk.title'),
    help: t('materials.bulk.help'),
    pickLabel: t('materials.fields.material'),
    pickPlaceholder: t('materials.entry.materialPlaceholder'),
    noMatchText: t('materials.bulk.noMatch'),
    useOptions: (search, enabled) => {
      // Entry is for stash-able crafting materials: refined + gems only.
      const { data = [] } = useQuery({
        queryKey: ['resource-types', search],
        queryFn: async () =>
          unwrapList<ResourceType>(
            (await api.get('/api/resource-types', { params: { search, categories: 'refined,gem' } })).data,
          ),
        enabled,
      })
      return data
    },
    optionId: (option) => option.id,
    optionLabel: (option) => option.name,
    // Category group headers are UI labels; unknown categories shown verbatim.
    groupBy: (option) => t(`materials.category.${option.category}`, { defaultValue: option.category }),
    accentOf: (pick) => rarityColor(pick?.rarity),
    unitOf: (pick) => (pick?.unit === 'pieces' ? t('materials.units.pcs') : t('materials.units.scu')),
    bandsOf: (pick) => pick?.known_qualities ?? [],
    // Gems count in whole pieces; crate goods in SCU to three decimals.
    stepOf: (pick, big) => (pick?.unit === 'pieces' ? (big ? 100 : 10) : big ? 0.1 : 0.01),
    isComplete: (row) => row.pick !== null && row.amount !== '' && row.quality !== '',
    save: (row: GridRow<ResourceType>, location: Location) => {
      const pieces = row.pick!.unit === 'pieces'
      const body: CreateResourceStack = {
        resource_type_id: row.pick!.id,
        quality: Number(row.quality),
        location_id: location.id,
        visibility: row.visibility,
        ...(pieces
          ? { quantity_pieces: Math.round(Number(row.amount)) }
          : { quantity_mscu: Math.round(Number(row.amount.replace(',', '.')) * 1000) }),
      }
      return api.post('/api/resource-stacks', body)
    },
    invalidate: ['resource-stacks', 'org-materials', 'resource-types'],
  }), [t])

  return <EntryGridDialog open={open} onClose={onClose} config={config} />
}
