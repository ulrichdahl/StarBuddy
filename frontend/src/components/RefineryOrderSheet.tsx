import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CloseIcon from '@mui/icons-material/Close'
import { api, unwrapList } from '../lib/api'
import { qualityColor, rarityColor } from '../lib/rarity'
import { formatDuration, parseDuration, REFINING_METHODS } from '../lib/refining'
import { useCellGrid, type CellKind, type GridLine } from '../lib/useCellGrid'
import type { SxProps, Theme } from '@mui/material/styles'
import type { Location, RefineryMaterial, ResourceType } from '../lib/types'
import { LocationSelect } from './LocationSelect'
import { BandPopper, cellSx, GRID_ROW_BORDER, gridInputSx, HeadCell } from './GridCell'

/** One material line of an order: what went in, and what comes back out. */
export interface OrderLine extends GridLine {
  pick: ResourceType | null
  quality: string
  qty: string
  yielded: string
}

/**
 * What a refinery takes in. Ore only: gems and gas are held and sold as they
 * are found, never refined, and offering them would put most of the catalogue
 * in front of someone typing up a job that can only contain a fraction of it.
 *
 * This narrows the picker, not the order. An order that already names something
 * else — a capture reading a row the terminal listed — still shows that row
 * under the name it was recorded with.
 */
const REFINABLE = 'ore'

/**
 * A material's name without the form it was found in.
 *
 * The catalogue carries both "Corundum (Ore)" and "Corundum (Raw)" — and
 * "Hephaestanite (R)", the same word truncated — for eight materials, with
 * identical quality ladders. They are one material, so the picker offers one
 * of them, under the bare name the terminal itself prints.
 */
const bareName = (name: string) => name.replace(/\s*\((?:Ore|Raw|R)\)$/i, '')

const KINDS: CellKind[] = ['pick', 'bands', 'number', 'number']
const COLS = [0, 1, 2, 3]
const TEMPLATE = '40px minmax(0, 1fr) 150px 130px 130px 68px'
const READ_TEMPLATE = '40px minmax(0, 1fr) 150px 130px 130px'

let seq = 0

export const blankLine = (): OrderLine => ({ key: ++seq, pick: null, quality: '', qty: '', yielded: '' })

/**
 * A line the order can carry. The yield is deliberately not required: the
 * terminal lists rows whose REFINE switch is off with no yield at all, and
 * inert material with a yield of zero, and both are worth recording.
 */
export const lineIsComplete = (row: OrderLine) => row.pick !== null && row.quality !== '' && row.qty !== ''

/**
 * A line with nothing left to answer, which is what earns a new one.
 *
 * Stricter than `lineIsComplete` on purpose: a row is savable without a yield,
 * because a row the terminal is not refining has none, but Enter should not
 * walk past an empty Yield on the way to a new line. Say 0 for a row that
 * gives nothing back and the line is done.
 */
export const lineIsFull = (row: OrderLine) => lineIsComplete(row) && row.yielded.trim() !== ''

/** The lines as the API wants them. */
export function linesToMaterials(rows: OrderLine[]): RefineryMaterial[] {
  return rows.filter(lineIsComplete).map((row) => {
    const yielded = row.yielded.trim() === '' ? null : Number(row.yielded.replace(',', '.'))
    return {
      resource: row.pick!.name,
      quality: Number(row.quality),
      qty: Number(row.qty.replace(',', '.')),
      yield_amount: yielded,
      to_do: null,
      done: null,
      // A row with nothing coming back is one the terminal is not refining.
      refine: yielded !== null && yielded > 0,
    }
  })
}

/** And back again, so an existing order opens in the sheet it was typed in. */
export function materialsToLines(materials: RefineryMaterial[], catalog: ResourceType[]): OrderLine[] {
  // Both spellings, so a row recorded as "Corundum" and one recorded as
  // "Corundum (Raw)" each find the entry that carries the quality bands. The
  // full name is set last so it wins where the two would collide.
  const byName = new Map<string, ResourceType>()
  for (const type of catalog) byName.set(bareName(type.name).toLowerCase(), type)
  for (const type of catalog) byName.set(type.name.toLowerCase(), type)
  return materials.map((material) => ({
    key: ++seq,
    // A material the catalogue has no entry for still shows, under the name the
    // terminal gave it — the order is worth reading even where a row cannot be
    // matched, and the dialog says separately which rows those are.
    pick: byName.get(material.resource.toLowerCase())
      ?? { id: -1, name: material.resource, category: 'ore', unit: 'scu' },
    quality: material.quality === null ? '' : String(material.quality),
    qty: material.qty === null ? '' : String(material.qty),
    yielded: material.yield_amount === null ? '' : String(material.yield_amount),
  }))
}

export interface RefineryOrderSheetProps {
  location: Location | null
  onLocation: (value: Location | null) => void
  method: string | null
  onMethod: (value: string | null) => void
  rows: OrderLine[]
  setRows: Dispatch<SetStateAction<OrderLine[]>>
  cost: string
  onCost: (value: string) => void
  /** The job's length, as typed — "22m 28s". */
  duration: string
  /**
   * `typed` separates a person setting the clock from the field being handed
   * the value it was already showing when they focused it. Only the first
   * counts as setting it.
   */
  onDuration: (value: string, typed: boolean) => void
  unit: string
  /**
   * Put the cursor in the refinery box on open. True for a new order, where the
   * refinery is the first thing to answer; false for one being edited, where
   * everything is already answered and grabbing the box would only pop its list
   * open over a sheet the reader is trying to look at.
   */
  autoFocus?: boolean
  /** A collected order is history: everything reads, nothing edits. */
  readOnly?: boolean
  /**
   * Seconds left on an order already running, ticked by the caller. While the
   * clock field is not being edited it shows this rather than what was typed,
   * so an open order counts down in the sheet the way it does in the list.
   */
  remaining?: number | null
}

/**
 * A refinery work order in the shape the terminal shows it: the refinery, the
 * process, then a line per material with its quality, what went in and what
 * comes back, and the cost and clock underneath.
 *
 * The same sheet records a new order and shows an existing one, so a player
 * reads a job in the layout they typed it in. Its keyboard model is the one
 * from the bulk material grid, in `useCellGrid` — arrows move, typing edits,
 * Enter finishes a line, Ctrl+Enter repeats it, Tab walks the cells.
 */
export function RefineryOrderSheet(props: RefineryOrderSheetProps) {
  const { location, onLocation, method, onMethod, rows, setRows, cost, onCost, duration, onDuration, unit } = props
  const readOnly = props.readOnly ?? false
  const { t } = useTranslation()
  const locationRef = useRef<HTMLInputElement>(null)
  /** Editing the clock stops it: a field cannot be typed into while it moves. */
  const [settingTime, setSettingTime] = useState(false)

  const grid = useCellGrid<OrderLine>({
    kinds: KINDS,
    rows,
    setRows,
    open: !readOnly,
    read: useCallback(
      (row: OrderLine, col: number) =>
        col === 0 ? (row.pick?.name ?? '') : col === 1 ? row.quality : col === 2 ? row.qty : row.yielded,
      [],
    ),
    // The material cell is written by picking from the catalogue, never by
    // committing text, so it has nothing to say here.
    write: useCallback(
      (_row: OrderLine, col: number, value: string) =>
        (col === 1 ? { quality: value } : col === 2 ? { qty: value } : col === 3 ? { yielded: value } : {}) as Partial<OrderLine>,
      [],
    ),
    bands: useCallback((row: OrderLine) => row.pick?.known_qualities ?? [], []),
    // The terminal counts in centi-SCU, so whole units are the small step and
    // hundreds the big one — a hold is thousands of them.
    step: useCallback((_row: OrderLine, _col: number, big: boolean) => (big ? 100 : 1), []),
    blank: useCallback(() => blankLine(), []),
    isComplete: lineIsComplete,
    isFull: lineIsFull,
    repeatCol: 2,
    leave: useCallback(() => locationRef.current?.focus(), []),
  })

  /** Ctrl+Enter repeats a line ready for the next set of numbers. */
  const repeatClear = useCallback(() => ({ key: ++seq, qty: '', yielded: '' }) as Partial<OrderLine>, [])

  // A new order opens on the refinery, which gates the whole thing — and the
  // grid is focusable, so without this the dialog would hand it the initial
  // focus and swallow the keys meant for the location list.
  const autoFocus = (props.autoFocus ?? false) && !readOnly
  useEffect(() => {
    if (!autoFocus) return
    const id = requestAnimationFrame(() => locationRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [autoFocus])

  const { data: found = [] } = useQuery({
    queryKey: ['resource-types', grid.filter, REFINABLE],
    queryFn: async () =>
      unwrapList<ResourceType>(
        (await api.get('/api/resource-types', { params: { search: grid.filter, categories: REFINABLE } })).data,
      ),
    enabled: !readOnly,
  })

  // One entry per material, named as the terminal names it. Recording the bare
  // name is also what the capture path records, so an order typed by hand and
  // the same order read off the screen come out identical.
  const catalog = useMemo(() => {
    const byName = new Map<string, ResourceType>()
    for (const type of found) {
      const name = bareName(type.name)
      if (!byName.has(name)) byName.set(name, { ...type, name })
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [found])

  const totalIn = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.qty.replace(',', '.')) || 0), 0),
    [rows],
  )
  const totalYield = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.yielded.replace(',', '.')) || 0), 0),
    [rows],
  )

  const pickOption = (pick: ResourceType) => {
    // Bands differ per material — a quality the new one does not have cannot
    // stand. A material with no known bands keeps whatever was typed.
    const bands = pick.known_qualities ?? []
    const current = rows[grid.sel.row]
    const keep = bands.length === 0 || bands.includes(Number(current.quality))
    grid.patch(grid.sel.row, { pick, quality: keep ? current.quality : '' })
    grid.setSel({ row: grid.sel.row, col: 1 })
    // Straight on into the quality, the way picking a material in the bulk
    // grid carries on into the amount. The list has to be opened from the
    // bands of the material just picked: the row itself has not been through
    // React yet, so anything reading it back would still see the old one.
    if (bands.length > 0) {
      const at = keep ? bands.indexOf(Number(current.quality)) : -1
      grid.setListIdx(at < 0 ? 0 : at)
      grid.setMode('select')
    } else {
      grid.setMode('text')
    }
  }

  // A running order shows its own clock until someone reaches for the field.
  const ticking = !settingTime && props.remaining !== null && props.remaining !== undefined
  const clock = formatDuration(props.remaining, t('refinery.dialog.ready'), { exact: true })
  // What the field is handed on focus. A finished order reads "Ready to
  // collect", which is no use to type over, so seed it with a real duration.
  const clockSeed = formatDuration(Math.max(0, props.remaining ?? 0), undefined, { exact: true })
  const badDuration = !ticking && parseDuration(duration) === null && duration.trim() !== ''

  // Who sees the haul sits with the cost and the clock rather than up in the
  // header: it is a fact about the order being saved, and it belongs beside
  // the button that saves it.

  const template = readOnly ? READ_TEMPLATE : TEMPLATE
  const header = [
    { label: t('refinery.dialog.material'), align: 'left' as const },
    { label: t('refinery.dialog.quality'), align: 'right' as const },
    { label: `${t('refinery.dialog.qty')} (${unit})`, align: 'right' as const },
    { label: `${t('refinery.dialog.yield')} (${unit})`, align: 'right' as const },
  ]

  return (
    <Stack spacing={2.5}>
      {/* The refinery first, then the process — the order the terminal asks
          for them, and the order they matter in: a process is a choice made
          at a particular refinery. */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, alignItems: 'start' }}>
        {readOnly ? (
          <>
            <Field label={t('refinery.sheet.refinery')} value={location?.name ?? '—'} />
            <Field label={t('refinery.dialog.method')} value={method ?? '—'} />
          </>
        ) : (
          <>
            <LocationSelect
              value={location}
              onChange={onLocation}
              label={t('refinery.sheet.refinery')}
              helperText={t('refinery.sheet.refineryHelp')}
              inputRef={locationRef}
              required
              autoFocus={autoFocus}
              size="small"
            />
            <Autocomplete
              freeSolo
              options={REFINING_METHODS}
              inputValue={method ?? ''}
              onInputChange={(_, next) => onMethod(next === '' ? null : next)}
              size="small"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('refinery.dialog.method')}
                  helperText={t('refinery.sheet.methodHelp')}
                />
              )}
            />
          </>
        )}
      </Box>

      <Box>
        <Box
          ref={grid.gridRef}
          tabIndex={readOnly ? -1 : 0}
          onFocus={readOnly ? undefined : grid.onGridFocus}
          onKeyDown={readOnly ? undefined : (event) => grid.onGridKey(event, repeatClear)}
          onBlur={() => {
            if (grid.discard.current) { grid.discard.current = false; return }
            if (grid.mode === 'select' && grid.bands.length > 0) grid.pickBand(grid.bands[grid.listIdx])
          }}
          sx={{ outline: 'none' }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: template, gap: 1.25, alignItems: 'center', px: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box />
            {header.map((column) => (
              <HeadCell key={column.label} align={column.align}>{column.label}</HeadCell>
            ))}
            {!readOnly && <Box />}
          </Box>

          {rows.map((line, r) => {
            // A row giving nothing back is one the refinery is not working on.
            const idle = line.pick !== null && (line.yielded.trim() === '' || Number(line.yielded) === 0)
            return (
              <Box
                key={line.key}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: template,
                  gap: 1.25,
                  alignItems: 'center',
                  px: 0.5,
                  py: 0.375,
                  borderBottom: 1,
                  borderColor: GRID_ROW_BORDER,
                  opacity: idle ? 0.55 : 1,
                }}
              >
                <Box sx={{ width: 26, height: 26, borderRadius: 1, bgcolor: 'rgba(91, 200, 219, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r + 1}</Typography>
                </Box>

                {COLS.map((c) => {
                  const editingHere = !readOnly && grid.sel.row === r && grid.sel.col === c && grid.mode === 'text'
                  const value = c === 0 ? (line.pick?.name ?? '') : c === 1 ? line.quality : c === 2 ? line.qty : line.yielded
                  return (
                    <Box
                      key={c}
                      ref={(el: HTMLDivElement | null) => { grid.cellRefs.current.set(grid.cellKey(r, c), el) }}
                      sx={cellSx({
                        on: grid.entered && grid.sel.row === r && grid.sel.col === c,
                        editing: grid.mode !== false,
                        align: c > 0 ? 'flex-end' : 'flex-start',
                        readOnly,
                      })}
                      onMouseDown={readOnly ? undefined : (e: MouseEvent) => {
                        if (editingHere) return
                        e.preventDefault()
                        grid.enter()
                        grid.commitLive()
                        grid.beginEditAt(r, c)
                      }}
                    >
                      {c === 0 && (
                        <Box sx={{ width: 3, height: 20, borderRadius: 1, flexShrink: 0, bgcolor: rarityColor(line.pick?.rarity) }} />
                      )}
                      {editingHere && c === 0 ? (
                        <Autocomplete
                          options={catalog}
                          value={line.pick}
                          onChange={(_, picked) => picked && typeof picked !== 'string' && pickOption(picked)}
                          inputValue={grid.filter}
                          // MUI resets a controlled inputValue when its value is
                          // null — which would eat the keystroke that opened the
                          // cell. Only what the user types counts.
                          onInputChange={(_, next, reason) => { if (reason !== 'reset') grid.setFilter(next) }}
                          getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
                          isOptionEqualToValue={(a, b) => a.id === b.id}
                          groupBy={(option) => t(`materials.category.${option.category}`, { defaultValue: option.category })}
                          autoHighlight
                          autoSelect
                          openOnFocus
                          filterOptions={(x) => x}
                          fullWidth
                          size="small"
                          sx={{ flexGrow: 1, minWidth: 0 }}
                          noOptionsText={t('materials.bulk.noMatch')}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              autoFocus
                              variant="standard"
                              placeholder={t('materials.entry.materialPlaceholder')}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') { grid.discard.current = true; grid.setMode(false) }
                                if (event.key === 'Tab') {
                                  event.preventDefault()
                                  if (event.shiftKey && grid.atOrigin()) grid.leaveGrid()
                                  else grid.nextCell(event.shiftKey)
                                }
                              }}
                              sx={{ '& .MuiInput-root:before, & .MuiInput-root:after': { borderBottom: 'none' } }}
                            />
                          )}
                        />
                      ) : editingHere ? (
                        <Box
                          component="input"
                          ref={grid.editRef}
                          defaultValue={value}
                          onKeyDown={(event) => grid.onEditKey(event, repeatClear)}
                          onBlur={(e: { target: { value: string } }) => {
                            if (grid.discard.current) { grid.discard.current = false; return }
                            grid.patch(r, (c === 1 ? { quality: e.target.value } : c === 2 ? { qty: e.target.value } : { yielded: e.target.value }) as Partial<OrderLine>)
                          }}
                          sx={{ ...gridInputSx, textAlign: 'right' }}
                        />
                      ) : (
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 14,
                            fontWeight: c === 1 ? 600 : 500,
                            flexGrow: c > 0 ? 1 : 0,
                            textAlign: c > 0 ? 'right' : 'left',
                            fontVariantNumeric: 'tabular-nums',
                            color: value === '' ? 'text.disabled' : c === 1 ? qualityColor(Number(value)) : 'text.primary',
                          }}
                        >
                          {value === '' ? (c === 3 && line.pick ? t('refinery.sheet.noYield') : t('common.none')) : value}
                        </Typography>
                      )}
                    </Box>
                  )
                })}

                {!readOnly && (
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <Tooltip title={t('bulk.repeat')}>
                      <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); grid.repeatRow(r, repeatClear()) }}>
                        <ContentCopyIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('bulk.remove')}>
                      <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); grid.removeRow(r) }}>
                        <CloseIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Box>
            )
          })}
        </Box>

        {!readOnly && (
          <BandPopper
            open={grid.mode === 'select' && grid.bands.length > 0}
            anchorEl={grid.bandAnchor}
            bands={grid.bands}
            activeIndex={grid.listIdx}
            onPick={grid.pickBand}
          />
        )}

        {!readOnly && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {t('refinery.sheet.keys')}
          </Typography>
        )}
      </Box>

      {/* The same column track as the materials above, so the two totals sit
          directly under the In and Yield they are totalling — a number and its
          sum in one line down the sheet. Cost and the clock take the width the
          material and quality columns leave. */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: { xs: '1fr 1fr', sm: template },
          alignItems: 'start',
          px: 0.5,
          pt: 2,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        {readOnly ? (
          <>
            <Box sx={{ gridColumn: { sm: 'span 3' }, display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <Field align="right" sx={{ maxWidth: 180 }} label={t('refinery.dialog.cost')} value={cost === '' ? '—' : `${cost} aUEC`} />
              <Box sx={{ flexGrow: 1 }} />
              <Field
                align="right"
                sx={{ width: 150, flexShrink: 0 }}
                label={t('refinery.dialog.remaining')}
                value={formatDuration(props.remaining, t('refinery.dialog.ready'))}
              />
            </Box>
          </>
        ) : (
          // Cost at the sheet's left edge, the clock at the right edge of the
          // quality column, and the clock's helper beside it rather than under
          // it — a line hanging below a column-width field wraps and drags the
          // whole row off true, which is what it did before.
          <Box sx={{ gridColumn: { sm: 'span 3' }, display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <TextField
              label={t('refinery.dialog.cost')}
              value={cost}
              onChange={(e) => onCost(e.target.value)}
              size="small"
              sx={{ maxWidth: 180 }}
              slotProps={{
                input: { endAdornment: <Adornment>aUEC</Adornment> },
                htmlInput: { style: { textAlign: 'right' } },
              }}
            />
            <Box sx={{ flexGrow: 1 }} />
            <Typography
              variant="caption"
              color={badDuration ? 'error' : 'text.secondary'}
              sx={{ textAlign: 'right', maxWidth: 200 }}
            >
              {badDuration ? t('refinery.sheet.durationBad') : t('refinery.sheet.durationHelp')}
            </Typography>
            <TextField
              label={t('refinery.dialog.remaining')}
              value={ticking ? clock : duration}
              onChange={(e) => onDuration(e.target.value, true)}
              // Focus freezes the clock and hands over what it last read, so
              // editing starts from the number on screen rather than from
              // whatever the job was first set to run for.
              onFocus={() => { if (ticking) onDuration(clockSeed, false); setSettingTime(true) }}
              onBlur={() => setSettingTime(false)}
              size="small"
              placeholder="22m 28s"
              error={badDuration}
              sx={{ width: 150, flexShrink: 0 }}
              slotProps={{ htmlInput: { style: { textAlign: 'right' } } }}
            />
          </Box>
        )}
        <Field align="right" label={t('refinery.sheet.totalIn')} value={`${totalIn.toLocaleString()} ${unit}`} />
        <Field align="right" label={t('refinery.dialog.yieldTotal')} value={`${totalYield.toLocaleString()} ${unit}`} />
      </Box>
    </Stack>
  )
}

function Field({ label, value, align = 'left', sx }: {
  label: string
  value: string
  align?: 'left' | 'right'
  sx?: SxProps<Theme>
}) {
  return (
    <Box sx={{ textAlign: align, ...sx }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  )
}

function Adornment({ children }: { children: string }) {
  return <Typography variant="caption" color="text.secondary">{children}</Typography>
}
