import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import GroupsIcon from '@mui/icons-material/Groups'
import HowToRegIcon from '@mui/icons-material/HowToReg'
import CloseIcon from '@mui/icons-material/Close'
import { apiErrorDetail } from '../lib/api'
import { qualityColor } from '../lib/rarity'
import { useCellGrid, type CellKind, type GridLine } from '../lib/useCellGrid'
import type { Location, Visibility } from '../lib/types'
import { LocationSelect } from './LocationSelect'
import { BandPopper, cellSx, GRID_ROW_BORDER, gridInputSx, HeadCell } from './GridCell'

/** One line of the entry grid; `pick` carries the unit and any quality bands. */
export interface GridRow<T> extends GridLine {
  pick: T | null
  amount: string
  quality: string
  visibility: Visibility
}

/**
 * What differs between the material and item grids. Everything else — the
 * cursor, the keyboard model, the trailing blank line, the batch save — is
 * the same for both.
 */
export interface EntryGridConfig<T> {
  title: string
  help: string
  /** Column heading for the catalog column, e.g. Material or Item. */
  pickLabel: string
  pickPlaceholder: string
  noMatchText: string
  /** Items accept a class that is not in the catalog; materials do not. */
  freeSolo?: boolean
  /** Catalog search for the text typed into the picker. */
  useOptions: (search: string, enabled: boolean) => T[]
  optionId: (option: T) => string | number
  optionLabel: (option: T) => string
  groupBy?: (option: T) => string
  renderOption?: (option: T) => ReactNode
  /** Left edge colour of the picked row; omit for no rarity bar. */
  accentOf?: (pick: T | null) => string
  /** Amount suffix, e.g. SCU or pcs — depends on the picked row. */
  unitOf: (pick: T | null) => string
  /**
   * Quality bands for the picked row. An empty list means the quality cell is
   * a typed number instead of a select — that is the only mode items have.
   */
  bandsOf: (pick: T | null) => number[]
  /** Amount step for Ctrl (small) and Shift (big) arrows. */
  stepOf: (pick: T | null, big: boolean) => number
  /** Quality a fresh line starts on; items default to the in-game 500. */
  defaultQuality?: string
  /** A line the server would accept. */
  isComplete: (row: GridRow<T>) => boolean
  save: (row: GridRow<T>, location: Location) => Promise<unknown>
  /** Query keys to refresh once anything saved. */
  invalidate: string[]
}

const KINDS: CellKind[] = ['pick', 'number', 'bands', 'toggle']
const COLS = [0, 1, 2, 3]
/** Grid template shared by the header and every line. */
const TEMPLATE = '40px minmax(0, 1fr) 180px 140px 84px 84px'

let seq = 0
/** A new line inherits the visibility of the one above — same as a repeat. */
const blankRow = <T,>(after?: GridRow<T>, quality = ''): GridRow<T> =>
  ({ key: ++seq, pick: null, amount: '', quality, visibility: after?.visibility ?? 'private' })

/** A line anyone has started typing into — kept rather than discarded. */
const isStarted = <T,>(row: GridRow<T>) => row.pick !== null || row.amount !== '' || row.quality !== ''

/**
 * Bulk stack entry as a spreadsheet, shared by materials and items: one line
 * per stack, location set once for the batch and visibility per line. What each
 * page contributes is in `EntryGridConfig`; the keyboard model lives in
 * `useCellGrid`, which the refinery order sheet uses too, so the two behave
 * identically.
 */
export function EntryGridDialog<T>({ open, onClose, config }: {
  open: boolean
  onClose: () => void
  config: EntryGridConfig<T>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const defaultQuality = config.defaultQuality ?? ''
  const [location, setLocation] = useState<Location | null>(null)
  const [rows, setRows] = useState<GridRow<T>[]>(() => [blankRow<T>(undefined, defaultQuality)])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(0)

  const locationRef = useRef<HTMLInputElement>(null)

  const bandsOf = config.bandsOf
  const optionLabel = config.optionLabel
  const isComplete = config.isComplete

  const grid = useCellGrid<GridRow<T>>({
    kinds: KINDS,
    rows,
    setRows,
    open,
    read: useCallback(
      (row: GridRow<T>, col: number) =>
        col === 0 ? (row.pick === null ? '' : optionLabel(row.pick)) : col === 1 ? row.amount : row.quality,
      [optionLabel],
    ),
    // The catalog cell is written by picking an option, never by committing
    // text, so it has nothing to say here.
    write: useCallback(
      (_row: GridRow<T>, col: number, value: string) =>
        (col === 1 ? { amount: value } : col === 2 ? { quality: value } : {}) as Partial<GridRow<T>>,
      [],
    ),
    bands: useCallback((row: GridRow<T>) => bandsOf(row.pick), [bandsOf]),
    toggle: useCallback(
      (row: GridRow<T>) => ({ visibility: row.visibility === 'private' ? 'org' : 'private' }) as Partial<GridRow<T>>,
      [],
    ),
    step: useCallback((row: GridRow<T>, _col: number, big: boolean) => config.stepOf(row.pick, big), [config]),
    blank: useCallback((after?: GridRow<T>) => blankRow(after, defaultQuality), [defaultQuality]),
    isComplete,
    leave: useCallback(() => locationRef.current?.focus(), []),
  })

  /** Ctrl+Enter repeats a line ready for the next amount. */
  const repeatClear = useCallback(() => ({ key: ++seq, amount: '' }) as Partial<GridRow<T>>, [])

  /**
   * The dialog is never unmounted, so closing has to park the cursor: an open
   * otherwise resumes in the cell that was being edited and reopens its picker.
   * Typed lines are deliberately kept.
   */
  const close = useCallback(() => {
    grid.reset()
    setSaved(0)
    onClose()
  }, [grid, onClose])

  // The dialog opens on the location picker — it gates the whole batch — so the
  // grid only claims focus once someone has actually reached into it. The grid
  // is focusable, so the dialog would otherwise hand it the initial focus and
  // swallow the keys meant for the location list.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => locationRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const options = config.useOptions(grid.filter, open)

  const pickOption = (pick: T) => {
    // Bands differ per catalog row — a quality the new one does not have cannot
    // stand. A free-typed quality (no bands) always survives.
    const bands = bandsOf(pick)
    const current = rows[grid.sel.row]
    const keep = bands.length === 0 || bands.includes(Number(current.quality))
    grid.patch(grid.sel.row, { pick, quality: keep ? current.quality : '' } as Partial<GridRow<T>>)
    grid.setSel({ row: grid.sel.row, col: 1 })
    // A fresh line carries straight on into the amount; an existing line is
    // only re-pointed, so it keeps whatever it already had.
    grid.setMode(current.amount === '' ? 'text' : false)
  }

  const setRowVisibility = (index: number, value: Visibility) => {
    grid.patch(index, { visibility: value } as Partial<GridRow<T>>)
  }

  const ready = useMemo(() => rows.filter(isComplete), [rows, isComplete])

  const saveAll = useMutation({
    mutationFn: async () => {
      if (!location) return
      setSaving(true)
      let done = 0
      const rest: GridRow<T>[] = []
      for (const line of rows) {
        if (!isComplete(line)) {
          // Half-typed lines are kept so nothing a user started is thrown away.
          if (isStarted(line)) rest.push(line)
          continue
        }
        try {
          await config.save(line, location)
          done++
        } catch (error) {
          rest.push({ ...line, error: apiErrorDetail(error) })
        }
      }
      for (const key of config.invalidate) queryClient.invalidateQueries({ queryKey: [key] })
      setRows(grid.withBlank(rest))
      grid.setSel({ row: 0, col: 0 })
      setSaving(false)
      // Nothing left to fix: get out of the way and say so in a snackbar. Lines
      // the server refused keep the dialog open, with their reason.
      if (!rest.some((line) => line.error)) close()
      setSaved(done)
    },
  })

  const failed = rows.some((r) => r.error)

  return (
    <>
    <Dialog open={open} onClose={close} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>{config.title}</Box>
        <IconButton size="small" onClick={close} aria-label={t('common.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, alignItems: 'end', mt: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
            {config.help}
          </Typography>
          <LocationSelect
            value={location}
            onChange={setLocation}
            label={t('bulk.location')}
            required
            autoFocus
            inputRef={locationRef}
            size="small"
            sx={{ width: 260 }}
          />
        </Box>

        <Box
          ref={grid.gridRef}
          tabIndex={0}
          onFocus={grid.onGridFocus}
        onKeyDown={(event) => grid.onGridKey(event, repeatClear)}
          onBlur={() => {
            if (grid.discard.current) { grid.discard.current = false; return }
            if (grid.mode === 'select' && grid.bands.length > 0) grid.pickBand(grid.bands[grid.listIdx])
          }}
          sx={{ outline: 'none' }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 1.25, alignItems: 'center', px: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box />
            <HeadCell>{config.pickLabel}</HeadCell>
            <HeadCell align="right">{t('bulk.amount')}</HeadCell>
            <HeadCell align="right">{t('bulk.quality')}</HeadCell>
            <HeadCell align="center">{t('bulk.visibility')}</HeadCell>
            <Box />
          </Box>

          {rows.map((line, r) => {
            const unit = config.unitOf(line.pick)
            return (
              <Box
                key={line.key}
                sx={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 1.25, alignItems: 'center', px: 0.5, py: 0.375, borderBottom: 1, borderColor: GRID_ROW_BORDER }}
              >
                <Box sx={{ width: 26, height: 26, borderRadius: 1, bgcolor: 'rgba(91, 200, 219, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r + 1}</Typography>
                </Box>

                {COLS.map((c) => {
                  const editingHere = grid.sel.row === r && grid.sel.col === c && grid.mode === 'text'
                  const value = c === 0
                    ? (line.pick === null ? '' : optionLabel(line.pick))
                    : c === 1 ? line.amount : line.quality
                  return (
                    <Box
                      key={c}
                      ref={(el: HTMLDivElement | null) => { grid.cellRefs.current.set(grid.cellKey(r, c), el) }}
                      sx={cellSx({
                        on: grid.entered && grid.sel.row === r && grid.sel.col === c,
                        editing: grid.mode !== false,
                        align: c === 3 ? 'center' : c > 0 ? 'flex-end' : 'flex-start',
                      })}
                      onMouseDown={(e: MouseEvent) => {
                        if (editingHere) return
                        e.preventDefault()
                        grid.enter()
                        grid.commitLive()
                        grid.beginEditAt(r, c)
                      }}
                    >
                      {c === 3 ? (
                        // Same marks as the blueprint list: you alone, or the org.
                        <Box sx={{ display: 'flex', gap: 0.5, mx: 'auto' }}>
                          <Tooltip title={t('bulk.private')}>
                            <HowToRegIcon
                              fontSize="small"
                              color={line.visibility === 'private' ? 'primary' : 'disabled'}
                              onMouseDown={(e: MouseEvent) => {
                                e.preventDefault()
                                e.stopPropagation()
                                grid.enter()
                                grid.commitLive()
                                grid.setSel({ row: r, col: 3 })
                                grid.setMode(false)
                                setRowVisibility(r, 'private')
                              }}
                            />
                          </Tooltip>
                          <Tooltip title={t('bulk.org')}>
                            <GroupsIcon
                              fontSize="small"
                              color={line.visibility === 'org' ? 'secondary' : 'disabled'}
                              onMouseDown={(e: MouseEvent) => {
                                e.preventDefault()
                                e.stopPropagation()
                                grid.enter()
                                grid.commitLive()
                                grid.setSel({ row: r, col: 3 })
                                grid.setMode(false)
                                setRowVisibility(r, 'org')
                              }}
                            />
                          </Tooltip>
                        </Box>
                      ) : null}
                      {c === 0 && config.accentOf && (
                        <Box sx={{ width: 3, height: 20, borderRadius: 1, flexShrink: 0, bgcolor: config.accentOf(line.pick) }} />
                      )}
                      {c === 3 ? null : editingHere && c === 0 ? (
                        // The same picker as the single-stack form: server-side
                        // search, grouped by category, strict to the catalog.
                        <Autocomplete
                          freeSolo={config.freeSolo}
                          options={options}
                          value={line.pick}
                          onChange={(_, picked) => picked && typeof picked !== 'string' && pickOption(picked)}
                          inputValue={grid.filter}
                          // MUI resets a controlled inputValue when its value is
                          // null — which would eat the keystroke that opened the
                          // cell. Only what the user types counts.
                          onInputChange={(_, next, reason) => { if (reason !== 'reset') grid.setFilter(next) }}
                          getOptionLabel={(option) => (typeof option === 'string' ? option : optionLabel(option as T))}
                          isOptionEqualToValue={(a, b) => config.optionId(a as T) === config.optionId(b as T)}
                          groupBy={config.groupBy && ((option) => config.groupBy!(option as T))}
                          renderOption={config.renderOption && ((props, option) => {
                            const { key, ...rest } = props as { key: string } & Record<string, unknown>
                            return <li key={key} {...rest}>{config.renderOption!(option as T)}</li>
                          })}
                          autoHighlight
                          autoSelect
                          openOnFocus
                          filterOptions={(x) => x}
                          fullWidth
                          size="small"
                          sx={{ flexGrow: 1, minWidth: 0 }}
                          noOptionsText={config.noMatchText}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              autoFocus
                              variant="standard"
                              placeholder={config.pickPlaceholder}
                              // Only the input's own keys — the Autocomplete root
                              // keeps MUI's handler, and the grid ignores keys it
                              // is not the target of.
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') { grid.discard.current = true; grid.setMode(false) }
                                if (event.key === 'Tab') {
                                  event.preventDefault()
                                  if (event.shiftKey && grid.atOrigin()) grid.leaveGrid()
                                  else grid.nextCell(event.shiftKey)
                                }
                              }}
                              // `params` already carries InputProps with the ref
                              // MUI needs — overriding it loses the input.
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
                            grid.patch(r, (c === 1 ? { amount: e.target.value } : { quality: e.target.value }) as Partial<GridRow<T>>)
                          }}
                          sx={{ ...gridInputSx, textAlign: 'right' }}
                        />
                      ) : (
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 14,
                            fontWeight: c === 2 ? 600 : 500,
                            flexGrow: c > 0 ? 1 : 0,
                            textAlign: c > 0 ? 'right' : 'left',
                            fontVariantNumeric: 'tabular-nums',
                            color: value === '' ? 'text.disabled' : c === 2 ? qualityColor(Number(value)) : 'text.primary',
                          }}
                        >
                          {value === '' ? t('common.none') : value}
                        </Typography>
                      )}
                      {c === 1 && <Typography variant="caption" color="text.secondary" sx={{ width: 30, flexShrink: 0 }}>{unit}</Typography>}
                    </Box>
                  )
                })}

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

                {line.error && (
                  <Typography variant="caption" color="error" sx={{ gridColumn: '2 / -1', pb: 0.5 }}>{line.error}</Typography>
                )}
              </Box>
            )
          })}
        </Box>

        <BandPopper
          open={grid.mode === 'select' && grid.bands.length > 0}
          anchorEl={grid.bandAnchor}
          bands={grid.bands}
          activeIndex={grid.listIdx}
          onPick={grid.pickBand}
        />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {t('bulk.keys')}
        </Typography>

        {failed && <Alert severity="warning" sx={{ mt: 2 }}>{t('bulk.failedHint')}</Alert>}
        {saving && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>{t('common.close')}</Button>
        <Button
          variant="contained"
          disabled={ready.length === 0 || location === null || saving}
          onClick={() => saveAll.mutate()}
        >
          {saving ? t('common.saving') : t('bulk.save', { count: ready.length })}
        </Button>
      </DialogActions>
    </Dialog>

    <Snackbar
      open={saved > 0}
      autoHideDuration={5000}
      onClose={() => setSaved(0)}
      message={t('bulk.saved', { count: saved })}
    />
    </>
  )
}
