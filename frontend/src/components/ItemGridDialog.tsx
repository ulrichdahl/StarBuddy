import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { CreateItemStack, Item, Location } from '../lib/types'
import { EntryGridDialog, type EntryGridConfig, type GridRow } from './EntryGridDialog'

/**
 * Items: the same grid as materials, minus the parts items do not have.
 * The catalog is free-solo — an unknown name is kept verbatim as the class —
 * amounts are whole pieces, and quality is a typed number rather than a band
 * list, since bought and crafted gear carries a grade the catalog cannot know.
 */
export function ItemGridDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()

  const config = useMemo<EntryGridConfig<Item>>(() => ({
    title: t('items.bulk.title'),
    help: t('items.bulk.help'),
    pickLabel: t('items.entry.item'),
    pickPlaceholder: t('items.entry.itemPlaceholder'),
    noMatchText: t('items.entry.noMatch'),
    freeSolo: true,
    useOptions: (search, enabled) => {
      const { data = [] } = useQuery({
        queryKey: ['items', search],
        queryFn: async () => unwrapList<Item>((await api.get('/api/items', { params: { search } })).data),
        placeholderData: keepPreviousData,
        enabled,
      })
      // MUI groups by adjacency, so the list has to arrive ordered by type —
      // memoised, because a fresh array each render resets the Autocomplete's
      // highlight and the arrow keys stop moving.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useMemo(() => [...data].sort((a, b) => {
        const ga = a.type_label ?? ''
        const gb = b.type_label ?? ''
        if (ga === gb) return 0
        if (ga === '') return 1
        if (gb === '') return -1
        return ga.localeCompare(gb)
      }), [data])
    },
    optionId: (option) => option.id,
    optionLabel: (option) => option.name,
    // Group headers are the wiki's own type labels — game data, verbatim.
    groupBy: (option) => option.type_label ?? '',
    renderOption: (option) => {
      const detail = [option.sub_type_label, option.manufacturer].filter(Boolean).join(' · ')
      return (
        <Typography noWrap title={detail ? `${option.name} — ${detail}` : option.name} sx={{ minWidth: 0 }}>
          {option.name}
          {detail && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {detail}
            </Typography>
          )}
        </Typography>
      )
    },
    // Items spawn at 500 in game; crafted or bought gear is typed over it.
    defaultQuality: '500',
    unitOf: () => '',
    bandsOf: () => [],
    stepOf: (_pick, big) => (big ? 100 : 10),
    // Quality is optional: most items have none.
    isComplete: (row) => row.pick !== null && row.amount !== '',
    save: (row: GridRow<Item>, location: Location) => {
      const body: CreateItemStack = {
        item_class: row.pick!.class_name ?? row.pick!.name,
        item_name: row.pick!.name,
        quality: row.quality === '' ? null : Number(row.quality),
        quantity: Math.round(Number(row.amount)),
        location_id: location.id,
        visibility: row.visibility,
      }
      return api.post('/api/item-stacks', body)
    },
    invalidate: ['item-stacks', 'org-items'],
  }), [t])

  return <EntryGridDialog open={open} onClose={onClose} config={config} />
}
