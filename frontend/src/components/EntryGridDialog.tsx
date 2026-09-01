import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
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
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
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
import type { Theme } from '@mui/material/styles'
import type { Location, Visibility } from '../lib/types'
import { LocationSelect } from './LocationSelect'

/** One line of the entry grid; `pick` carries the unit and any quality bands. */
export interface GridRow<T> {
  key: number
  pick: T | null
  amount: string
  quality: string
  visibility: Visibility
  /** Set when the last save rejected this line; cleared when it is edited. */
  error?: string
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

type Col = 0 | 1 | 2 | 3
const COLS: Col[] = [0, 1, 2, 3]
const LAST_COL: Col = 3

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
 * per stack, location set once for the batch and visibility per line. What
 * each page contributes is in `EntryGridConfig`. Keyboard model (designed in
 * `designs/material-entry-grid.html`):
 *
 * - arrows move between cells, so they no longer step the amount; only
 *   Ctrl+↑↓ and Shift+↑↓ still do, inside the amount cell
 * - only the focused cell is an editor: the catalog cell is an autocomplete,
 *   quality a select of the row's bands or a typed number when it has none
 * - Enter saves the line and moves to the next, Ctrl+Enter repeats the line
 *   with the amount cleared, Tab walks the cells
 * - Space toggles the visibility cell; a new line inherits the line above
 * - the grid always ends on one empty line, added once the last is complete
 */
export function EntryGridDialog<T>({ open, onClose, config }: {
  open: boolean
  onClose: () => void
  config: EntryGridConfig<T>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const isComplete = config.isComplete
  /**
   * The grid ends on one empty line so there is always somewhere to type next.
   * It appears only once the last line is finished — filling the bottom line
   * in must not make a second pop up under the cursor while it is half typed.
   */
  const defaultQuality = config.defaultQuality ?? ''
  const withBlank = useCallback((list: GridRow<T>[]) =>
    list.length === 0 || isComplete(list[list.length - 1])
      ? [...list, blankRow(list[list.length - 1], defaultQuality)]
      : list, [isComplete, defaultQuality])

  const [location, setLocation] = useState<Location | null>(null)
  const [rows, setRows] = useState<GridRow<T>[]>(() => [blankRow<T>(undefined, config.defaultQuality ?? '')])
  const [sel, setSel] = useState<{ row: number; col: Col }>({ row: 0, col: 0 })
  // 'text' is an input in the cell; 'select' is the band list, which the grid drives.
  const [mode, setMode] = useState<false | 'text' | 'select'>(false)
  const [listIdx, setListIdx] = useState(0)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(0)

  const gridRef = useRef<HTMLDivElement>(null)
  /** Set by Escape so the blur that follows discards instead of committing. */
  const discard = useRef(false)
  const locationRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>())

  const focusGrid = useCallback(() => gridRef.current?.focus(), [])

  /**
   * The dialog is never unmounted, so closing has to park the cursor: an open
   * otherwise resumes in the cell that was being edited and reopens its
   * picker. Typed lines are deliberately kept.
   */
  const close = useCallback(() => {
    setMode(false)
    setSel({ row: 0, col: 0 })
    setFilter('')
    setSaved(0)
    onClose()
  }, [onClose])

  // The dialog opens on the location picker — it gates the whole batch — so
  // the grid only claims focus once someone has actually reached into it.
  const touched = useRef(false)
  useEffect(() => {
    if (!open) { touched.current = false; return }
    // The grid is focusable, so the dialog would otherwise hand it the initial
    // focus and swallow the keys meant for the location list.
    const id = requestAnimationFrame(() => locationRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (mode === 'text') editRef.current?.focus()
    else if (open && touched.current) focusGrid()
  }, [mode, sel.row, sel.col, open, focusGrid])

  const options = config.useOptions(filter, open)

  const patch = useCallback((index: number, next: Partial<GridRow<T>>) => {
    setRows((current) => withBlank(current.map((row, i) => (i === index ? { ...row, ...next, error: undefined } : row))))
  }, [withBlank])

  const bandsOf = config.bandsOf
  const row = rows[sel.row]
  const bands = row ? bandsOf(row.pick) : []

  const move = useCallback((r: number, c: Col) => {
    setMode(false)
    setSel({ row: Math.max(0, Math.min(rows.length - 1, r)), col: Math.max(0, Math.min(LAST_COL, c)) as Col })
  }, [rows.length])

  const beginEditAt = useCallback((atRow: number, atCol: Col, seed?: string) => {
    const target = rows[atRow]
    if (!target) return
    setSel({ row: atRow, col: atCol })
    const sel = { row: atRow, col: atCol }
    if (sel.col === 3) {
      setRows((current) => current.map((line, i) =>
        i === sel.row ? { ...line, visibility: line.visibility === 'private' ? 'org' : 'private', error: undefined } : line))
      return
    }
    if (sel.col === 0) {
      setFilter(seed ?? '')
      setListIdx(0)
      setMode('text')
      return
    }
    if (sel.col === 2 && bandsOf(target.pick).length > 0) {
      const at = bandsOf(target.pick).indexOf(Number(target.quality))
      setListIdx(at < 0 ? 0 : at)
      if (seed) {
        const hit = bandsOf(target.pick).findIndex((b) => String(b).startsWith(seed))
        if (hit >= 0) setListIdx(hit)
      }
      setMode('select')
      return
    }
    setMode('text')
    if (seed !== undefined) requestAnimationFrame(() => { if (editRef.current) editRef.current.value = seed })
  }, [rows, bandsOf])

  const beginEdit = useCallback((seed?: string) => beginEditAt(sel.row, sel.col, seed), [beginEditAt, sel])

  const setRowVisibility = (index: number, value: Visibility) => {
    setRows((current) => current.map((line, i) => (i === index ? { ...line, visibility: value, error: undefined } : line)))
  }

  /**
   * A mousedown that moves the cursor calls preventDefault, so the open editor
   * never blurs and React unmounts it unheard. Take its value first.
   */
  const commitLive = () => {
    if (mode !== 'text' || sel.col === 0 || !editRef.current) return
    patch(sel.row, sel.col === 1 ? { amount: editRef.current.value } : { quality: editRef.current.value })
  }

  /** Enter: this line is done, move to the next one, making it if needed. */
  const completeRow = useCallback(() => {
    setMode(false)
    setRows((current) => (sel.row === current.length - 1 ? [...current, blankRow(current[current.length - 1], defaultQuality)] : current))
    setSel({ row: sel.row + 1, col: 0 })
  }, [sel.row, defaultQuality])

  const repeatRow = useCallback((from: number) => {
    setRows((current) => {
      const copy = current.slice()
      copy.splice(from + 1, 0, { ...current[from], key: ++seq, amount: '', error: undefined })
      return withBlank(copy)
    })
    setSel({ row: from + 1, col: 1 })
    setMode('text')
  }, [withBlank])

  const removeRow = (index: number) => {
    setRows((current) => (current.length < 2 ? current : withBlank(current.filter((_, i) => i !== index))))
    move(Math.max(0, index - 1), sel.col)
  }

  const pickOption = (pick: T) => {
    // Bands differ per catalog row — a quality the new one does not have
    // cannot stand. A free-typed quality (no bands) always survives.
    const bands = bandsOf(pick)
    const keep = bands.length === 0 || bands.includes(Number(rows[sel.row].quality))
    patch(sel.row, { pick, quality: keep ? rows[sel.row].quality : '' })
    setSel({ row: sel.row, col: 1 })
    // A fresh line carries straight on into the amount; an existing line is
    // only re-pointed, so it keeps whatever it already had.
    setMode(rows[sel.row].amount === '' ? 'text' : false)
  }

  const pickBand = (band: number) => {
    patch(sel.row, { quality: String(band) })
    setMode(false)
  }

  const step = (delta: number) => {
    const input = editRef.current
    if (!input) return
    const value = Math.max(0, (Number(String(input.value).replace(',', '.')) || 0) + delta)
    // Whole steps stay whole; fractional ones keep at most three decimals.
    input.value = Number.isInteger(delta) && Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  }

  /** Shift+Tab off the first cell leaves the grid for the batch controls. */
  const atOrigin = () => sel.row === 0 && sel.col === 0
  const leaveGrid = () => {
    setMode(false)
    locationRef.current?.focus()
  }

  const nextCell = (back: boolean) => {
    if (back) {
      if (sel.col > 0) move(sel.row, (sel.col - 1) as Col)
      else move(sel.row - 1, LAST_COL)
      return
    }
    if (sel.col < LAST_COL) {
      const to = (sel.col + 1) as Col
      setSel({ row: sel.row, col: to })
      // Arriving on Quality opens the band list straight away.
      setMode(to === 2 && bandsOf(rows[sel.row].pick).length > 0 ? 'select' : false)
      if (to === 2) {
        const at = bandsOf(rows[sel.row].pick).indexOf(Number(rows[sel.row].quality))
        setListIdx(at < 0 ? 0 : at)
      }
      return
    }
    move(sel.row + 1, 0)
  }

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only when the grid itself holds focus — never on the way out of a
    // control that merely sits inside it.
    if (event.target !== event.currentTarget) return
    touched.current = true
    const k = event.key

    if (mode === 'select') {
      if (k === 'Escape') { event.preventDefault(); discard.current = true; setMode(false); return }
      if (k === 'ArrowUp') { event.preventDefault(); setListIdx((i) => Math.max(0, i - 1)); return }
      if (k === 'ArrowDown') { event.preventDefault(); setListIdx((i) => Math.min(bands.length - 1, i + 1)); return }
      if (k === 'Enter') {
        event.preventDefault()
        pickBand(bands[listIdx])
        if (event.ctrlKey || event.metaKey) repeatRow(sel.row)
        else completeRow()
        return
      }
      if (k === 'Tab') { event.preventDefault(); pickBand(bands[listIdx]); nextCell(event.shiftKey); return }
      if (k >= '0' && k <= '9') {
        event.preventDefault()
        const hit = bands.findIndex((b) => String(b).startsWith(k))
        if (hit >= 0) setListIdx(hit)
        return
      }
      return
    }

    if (mode) return // a text cell owns its keys

    if (k === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); repeatRow(sel.row); return }
    if (k === 'Enter') { event.preventDefault(); completeRow(); return }
    if (k === 'ArrowUp') { event.preventDefault(); move(sel.row - 1, sel.col); return }
    if (k === 'ArrowDown') { event.preventDefault(); move(sel.row + 1, sel.col); return }
    if (k === 'ArrowLeft') { event.preventDefault(); move(sel.row, (sel.col - 1) as Col); return }
    if (k === 'ArrowRight') { event.preventDefault(); move(sel.row, (sel.col + 1) as Col); return }
    if (k === 'Tab') {
      event.preventDefault()
      if (event.shiftKey && atOrigin()) leaveGrid()
      else nextCell(event.shiftKey)
      return
    }
    if (k === ' ') { event.preventDefault(); beginEdit(); return }
    if (k === 'Backspace' || k === 'Delete') {
      event.preventDefault()
      if (sel.col === 3) return
      patch(sel.row, sel.col === 0 ? { pick: null } : sel.col === 1 ? { amount: '' } : { quality: '' })
      return
    }
    if (k.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); beginEdit(k) }
  }

  const onEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // The input sits inside the grid: without this the grid handler would run
    // again on the state this one just changed, acting twice on one key.
    event.stopPropagation()
    const k = event.key
    const input = event.currentTarget

    if (k === 'Escape') { event.preventDefault(); setMode(false); return }

    if (sel.col === 1 && (k === 'ArrowUp' || k === 'ArrowDown') && (event.ctrlKey || event.shiftKey)) {
      event.preventDefault()
      step((k === 'ArrowUp' ? 1 : -1) * config.stepOf(rows[sel.row].pick, event.shiftKey))
      return
    }

    const commit = () => patch(sel.row, sel.col === 1 ? { amount: input.value } : { quality: input.value })

    if (k === 'Tab') { event.preventDefault(); commit(); nextCell(event.shiftKey); return }
    if (k === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); repeatRow(sel.row); return }
    if (k === 'Enter') { event.preventDefault(); commit(); completeRow() }
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
      setRows(withBlank(rest))
      setSel({ row: 0, col: 0 })
      setSaving(false)
      // Nothing left to fix: get out of the way and say so in a snackbar.
      // Lines the server refused keep the dialog open, with their reason.
      if (!rest.some((line) => line.error)) close()
      setSaved(done)
    },
  })

  const failed = rows.some((r) => r.error)
  const cellKey = (r: number, c: Col) => `${r}:${c}`

  const cellSx = (r: number, c: Col) => {
    const on = sel.row === r && sel.col === c
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      px: 1.25,
      py: 0.875,
      minHeight: 22,
      borderRadius: 1,
      cursor: 'pointer',
      justifyContent: c === 3 ? 'center' : c > 0 ? 'flex-end' : 'flex-start',
      border: '1px solid',
      borderColor: on ? 'primary.main' : 'transparent',
      bgcolor: on && !mode ? 'rgba(91, 200, 219, 0.07)' : 'transparent',
      boxShadow: on && mode ? (theme: Theme) => `0 0 0 1px ${theme.palette.primary.main}` : 'none',
    }
  }

  const inputSx = {
    width: '100%',
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'inherit',
    font: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    padding: 0,
  } as const

  const anchorFn = () => cellRefs.current.get(cellKey(sel.row, sel.col)) ?? gridRef.current!

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
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKey}
          onBlur={() => {
            if (discard.current) { discard.current = false; return }
            if (mode === 'select' && bands.length > 0) pickBand(bands[listIdx])
          }}
          sx={{ outline: 'none' }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 1.25, alignItems: 'center', px: 0.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box />
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              {config.pickLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: 'right' }}>
              {t('bulk.amount')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: 'right' }}>
              {t('bulk.quality')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: 'center' }}>
              {t('bulk.visibility')}
            </Typography>
            <Box />
          </Box>

          {rows.map((line, r) => {
            const unit = config.unitOf(line.pick)
            return (
              <Box
                key={line.key}
                sx={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 1.25, alignItems: 'center', px: 0.5, py: 0.375, borderBottom: 1, borderColor: 'rgba(91, 200, 219, 0.06)' }}
              >
                <Box sx={{ width: 26, height: 26, borderRadius: 1, bgcolor: 'rgba(91, 200, 219, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r + 1}</Typography>
                </Box>

                {COLS.map((c) => {
                  const editingHere = sel.row === r && sel.col === c && mode === 'text'
                  const value = c === 0
                    ? (line.pick === null ? '' : config.optionLabel(line.pick))
                    : c === 1 ? line.amount : line.quality
                  return (
                    <Box
                      key={c}
                      ref={(el: HTMLDivElement | null) => { cellRefs.current.set(cellKey(r, c), el) }}
                      sx={cellSx(r, c)}
                      onMouseDown={(e: MouseEvent) => {
                        if (editingHere) return
                        e.preventDefault()
                        touched.current = true
                        commitLive()
                        beginEditAt(r, c)
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
                                touched.current = true
                                commitLive()
                                setSel({ row: r, col: 3 })
                                setMode(false)
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
                                touched.current = true
                                commitLive()
                                setSel({ row: r, col: 3 })
                                setMode(false)
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
                          inputValue={filter}
                          // MUI resets a controlled inputValue when its value is
                          // null — which would eat the keystroke that opened the
                          // cell. Only what the user types counts.
                          onInputChange={(_, next, reason) => { if (reason !== 'reset') setFilter(next) }}
                          getOptionLabel={(option) => (typeof option === 'string' ? option : config.optionLabel(option as T))}
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
                                if (event.key === 'Escape') { discard.current = true; setMode(false) }
                                if (event.key === 'Tab') {
                                  event.preventDefault()
                                  if (event.shiftKey && atOrigin()) leaveGrid()
                                  else nextCell(event.shiftKey)
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
                          ref={editRef}
                          defaultValue={value}
                          onKeyDown={onEditKey}
                          onBlur={(e: { target: { value: string } }) => {
                            if (discard.current) { discard.current = false; return }
                            patch(r, c === 1 ? { amount: e.target.value } : { quality: e.target.value })
                          }}
                          sx={{ ...inputSx, textAlign: 'right' }}
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
                    <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); repeatRow(r) }}>
                      <ContentCopyIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('bulk.remove')}>
                    <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); removeRow(r) }}>
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

        {/* The band list hangs off the focused quality cell. */}
        <Popper open={mode === 'select' && bands.length > 0} anchorEl={anchorFn} placement="bottom-end" style={{ zIndex: 1400 }}>
          <Paper sx={{ mt: 0.5, py: 0.5, minWidth: 130, maxHeight: 260, overflowY: 'auto', border: 1, borderColor: 'primary.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pb: 0.5, textAlign: 'right' }}>
              {t('bulk.bands')}
            </Typography>
            {bands.map((band, i) => (
              <Box
                key={band}
                onMouseDown={(e) => { e.preventDefault(); pickBand(band) }}
                sx={{ px: 1.5, py: 0.75, cursor: 'pointer', textAlign: 'right', fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: qualityColor(band), bgcolor: i === listIdx ? 'rgba(91, 200, 219, 0.16)' : 'transparent' }}
              >
                {band}
              </Box>
            ))}
          </Paper>
        </Popper>

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
