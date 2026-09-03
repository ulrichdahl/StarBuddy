import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'

/**
 * What a column does when the cursor lands on it.
 *
 * - `pick` opens a catalog autocomplete
 * - `number` is a typed value that Ctrl+↑↓ and Shift+↑↓ step
 * - `bands` is a list of known values, falling back to a typed number for a
 *   row that has none
 * - `toggle` has no editor: reaching it flips the row
 */
export type CellKind = 'pick' | 'number' | 'bands' | 'toggle'

/**
 * The two fields every grid line carries: a key React can hold on to across
 * inserts and removals, and the reason the last save refused it.
 */
export interface GridLine {
  key: number
  error?: string
}

/** What the grid needs to know about the rows it is driving. */
export interface CellGridSpec<R extends GridLine> {
  /** One kind per column, left to right. */
  kinds: CellKind[]
  rows: R[]
  setRows: Dispatch<SetStateAction<R[]>>
  /** The cell's value as text — what an editor opens on. */
  read: (row: R, col: number) => string
  /** The change committing a cell makes to its row. */
  write: (row: R, col: number, value: string) => Partial<R>
  /** Known values for a `bands` column; empty means it types instead. */
  bands: (row: R) => number[]
  /** The change flipping a `toggle` cell makes. */
  toggle?: (row: R) => Partial<R>
  /** Step for Ctrl (small) and Shift (big) arrows in a `number` column. */
  step?: (row: R, col: number, big: boolean) => number
  /** A fresh trailing line, inheriting from the one above it. */
  blank: (after?: R) => R
  /** A line the server would accept, which is what earns a new blank one. */
  isComplete: (row: R) => boolean
  /**
   * A line with nothing left to type. Supplying it changes what Enter does:
   * instead of finishing the line, Enter walks to the next cell still empty
   * and only starts a new line once the row is full. Leave it out and Enter
   * finishes the line wherever the cursor is.
   */
  isFull?: (row: R) => boolean
  /** Whether the grid is on screen at all; focus is only claimed when it is. */
  open?: boolean
  /** Where Shift+Tab off the first cell goes — the batch controls above. */
  leave?: () => void
  /** The cell a repeated line opens on; the first thing that differs on it. */
  repeatCol?: number
}

/**
 * The spreadsheet keyboard model, shared by every entry grid.
 *
 * Designed in `designs/material-entry-grid.html` and used by both the bulk
 * stack entry and the refinery order sheet, so the two behave identically:
 *
 * - arrows move between cells, so they no longer step a number; only Ctrl+↑↓
 *   and Shift+↑↓ still do, inside a number cell
 * - only the focused cell is an editor
 * - Enter finishes the line and moves to the next, Ctrl+Enter repeats the line,
 *   Tab walks the cells
 * - Space opens the focused cell, which for a toggle means flipping it
 * - the grid always ends on one empty line, added once the last is complete
 *
 * The caller still owns the rows and the rendering; this owns the cursor, the
 * editing mode, and every key that acts on them.
 */
export function useCellGrid<R extends GridLine>(spec: CellGridSpec<R>) {
  const { kinds, rows, setRows, read, write, bands, toggle, step, blank, isComplete, isFull, open = true, leave, repeatCol = 1 } = spec
  const lastCol = kinds.length - 1

  const [sel, setSel] = useState({ row: 0, col: 0 })
  // 'text' is an input in the cell; 'select' is the band list, which the grid drives.
  const [mode, setMode] = useState<false | 'text' | 'select'>(false)
  const [listIdx, setListIdx] = useState(0)
  const [filter, setFilter] = useState('')

  const gridRef = useRef<HTMLDivElement>(null)
  /** Set by Escape so the blur that follows discards instead of committing. */
  const discard = useRef(false)
  const editRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>())
  /**
   * Whether anyone has reached into the grid yet. It governs two things: the
   * grid only claims focus back once it has been entered, and it draws no
   * cursor before then — a highlighted cell in a sheet whose focus is still up
   * in the header is claiming a selection that does not exist.
   *
   * Kept as both state and a ref: the render needs the one, and the handlers
   * need a value that is true immediately rather than a render later.
   */
  const [entered, setEntered] = useState(false)
  const touched = useRef(false)
  const enter = useCallback(() => {
    touched.current = true
    setEntered(true)
  }, [])

  const focusGrid = useCallback(() => gridRef.current?.focus(), [])

  useEffect(() => {
    if (!open) { touched.current = false; setEntered(false) }
  }, [open])

  useEffect(() => {
    if (mode === 'text') editRef.current?.focus()
    else if (open && touched.current) focusGrid()
  }, [mode, sel.row, sel.col, open, focusGrid])

  /**
   * The grid ends on one empty line so there is always somewhere to type next.
   * It appears only once the last line is finished — filling the bottom line in
   * must not make a second pop up under the cursor while it is half typed.
   */
  const withBlank = useCallback(
    (list: R[]) => (list.length === 0 || isComplete(list[list.length - 1]) ? [...list, blank(list[list.length - 1])] : list),
    [isComplete, blank],
  )

  const patch = useCallback(
    (index: number, next: Partial<R>) => {
      setRows((current) =>
        withBlank(current.map((row, i) => (i === index ? { ...row, ...next, error: undefined } : row))),
      )
    },
    [setRows, withBlank],
  )

  const move = useCallback(
    (r: number, c: number) => {
      setMode(false)
      setSel({ row: Math.max(0, Math.min(rows.length - 1, r)), col: Math.max(0, Math.min(lastCol, c)) })
    },
    [rows.length, lastCol],
  )

  const openBands = useCallback(
    (row: R, current: string, seed?: string) => {
      const list = bands(row)
      const at = list.indexOf(Number(current))
      let index = at < 0 ? 0 : at
      if (seed) {
        const hit = list.findIndex((b) => String(b).startsWith(seed))
        if (hit >= 0) index = hit
      }
      setListIdx(index)
      setMode('select')
    },
    [bands],
  )

  const beginEditAt = useCallback(
    (atRow: number, atCol: number, seed?: string) => {
      const target = rows[atRow]
      if (!target) return
      setSel({ row: atRow, col: atCol })
      const kind = kinds[atCol]
      if (kind === 'toggle') {
        if (toggle) patch(atRow, toggle(target))
        return
      }
      if (kind === 'pick') {
        setFilter(seed ?? '')
        setListIdx(0)
        setMode('text')
        return
      }
      if (kind === 'bands' && bands(target).length > 0) {
        openBands(target, read(target, atCol), seed)
        return
      }
      setMode('text')
      if (seed !== undefined) {
        requestAnimationFrame(() => {
          if (editRef.current) editRef.current.value = seed
        })
      }
    },
    [rows, kinds, toggle, patch, bands, openBands, read],
  )

  const beginEdit = useCallback((seed?: string) => beginEditAt(sel.row, sel.col, seed), [beginEditAt, sel])

  /**
   * A mousedown that moves the cursor calls preventDefault, so the open editor
   * never blurs and React unmounts it unheard. Take its value first.
   */
  const commitLive = useCallback(() => {
    if (mode !== 'text' || kinds[sel.col] === 'pick' || !editRef.current) return
    patch(sel.row, write(rows[sel.row], sel.col, editRef.current.value))
  }, [mode, kinds, sel, patch, write, rows])

  /** Enter: this line is done, move to the next one, making it if needed. */
  const completeRow = useCallback(() => {
    setMode(false)
    setRows((current) => (sel.row === current.length - 1 ? [...current, blank(current[current.length - 1])] : current))
    setSel({ row: sel.row + 1, col: 0 })
  }, [sel.row, setRows, blank])

  /** Ctrl+Enter: the same line again, ready for the next amount. */
  const repeatRow = useCallback(
    (from: number, clear: Partial<R>) => {
      setRows((current) => {
        const copy = current.slice()
        copy.splice(from + 1, 0, { ...current[from], ...clear })
        return withBlank(copy)
      })
      setSel({ row: from + 1, col: repeatCol })
      setMode('text')
    },
    [setRows, withBlank, repeatCol],
  )

  /**
   * What Enter does.
   *
   * With `isFull`, a half-typed line keeps the cursor on itself and sends it to
   * the next cell still empty — the row is what is being filled in, not the
   * sheet — and only a row with every cell answered starts a new line. The
   * scan begins after the current cell so that the value just committed, which
   * has not been through React yet, is not mistaken for an empty one; it wraps
   * so a cell skipped earlier is still come back to.
   */
  const advance = useCallback(() => {
    const row = rows[sel.row]
    if (!isFull || !row || isFull(row)) {
      completeRow()
      return
    }
    const order = [
      ...Array.from({ length: lastCol - sel.col }, (_, i) => sel.col + 1 + i),
      ...Array.from({ length: sel.col }, (_, i) => i),
    ]
    const next = order.find((c) => kinds[c] !== 'toggle' && read(row, c) === '')
    if (next === undefined) completeRow()
    else beginEditAt(sel.row, next)
  }, [rows, sel, isFull, completeRow, lastCol, kinds, read, beginEditAt])

  const removeRow = useCallback(
    (index: number) => {
      setRows((current) => (current.length < 2 ? current : withBlank(current.filter((_, i) => i !== index))))
      move(Math.max(0, index - 1), sel.col)
    },
    [setRows, withBlank, move, sel.col],
  )

  const atOrigin = () => sel.row === 0 && sel.col === 0
  const leaveGrid = useCallback(() => {
    setMode(false)
    leave?.()
  }, [leave])

  const nextCell = useCallback(
    (back: boolean) => {
      if (back) {
        if (sel.col > 0) move(sel.row, sel.col - 1)
        else move(sel.row - 1, lastCol)
        return
      }
      if (sel.col < lastCol) {
        const to = sel.col + 1
        setSel({ row: sel.row, col: to })
        // Arriving on a band column opens its list straight away.
        const row = rows[sel.row]
        if (kinds[to] === 'bands' && bands(row).length > 0) openBands(row, read(row, to))
        else setMode(false)
        return
      }
      move(sel.row + 1, 0)
    },
    [sel, lastCol, move, rows, kinds, bands, openBands, read],
  )

  const row = rows[sel.row]
  const bandList = row && kinds[sel.col] === 'bands' ? bands(row) : []

  const pickBand = useCallback(
    (band: number) => {
      patch(sel.row, write(rows[sel.row], sel.col, String(band)))
      setMode(false)
    },
    [patch, sel, write, rows],
  )

  /**
   * Focus arriving on the grid.
   *
   * Only from outside it: the grid takes its own focus back every time an
   * editor closes, and opening one again on that would make arrowing around
   * the sheet impossible. Tabbing in from the controls above, though, should
   * land in a cell ready to type — that is what a spreadsheet does.
   */
  const onGridFocus = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget as Node | null
    if (from && gridRef.current?.contains(from)) return
    enter()
    if (mode === false) beginEdit()
  }

  /** Keys while the grid itself holds focus. `repeat` says what a repeat clears. */
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>, repeat: (row: R) => Partial<R>) => {
    // Only when the grid itself holds focus — never on the way out of a control
    // that merely sits inside it.
    if (event.target !== event.currentTarget) return
    enter()
    const k = event.key

    if (mode === 'select') {
      if (k === 'Escape') { event.preventDefault(); discard.current = true; setMode(false); return }
      if (k === 'ArrowUp') { event.preventDefault(); setListIdx((i) => Math.max(0, i - 1)); return }
      if (k === 'ArrowDown') { event.preventDefault(); setListIdx((i) => Math.min(bandList.length - 1, i + 1)); return }
      if (k === 'Enter') {
        event.preventDefault()
        pickBand(bandList[listIdx])
        if (event.ctrlKey || event.metaKey) repeatRow(sel.row, repeat(rows[sel.row]))
        else advance()
        return
      }
      if (k === 'Tab') { event.preventDefault(); pickBand(bandList[listIdx]); nextCell(event.shiftKey); return }
      if (k >= '0' && k <= '9') {
        event.preventDefault()
        const hit = bandList.findIndex((b) => String(b).startsWith(k))
        if (hit >= 0) setListIdx(hit)
        return
      }
      return
    }

    if (mode) return // a text cell owns its keys

    if (k === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); repeatRow(sel.row, repeat(rows[sel.row])); return }
    if (k === 'Enter') { event.preventDefault(); advance(); return }
    if (k === 'ArrowUp') { event.preventDefault(); move(sel.row - 1, sel.col); return }
    if (k === 'ArrowDown') { event.preventDefault(); move(sel.row + 1, sel.col); return }
    if (k === 'ArrowLeft') { event.preventDefault(); move(sel.row, sel.col - 1); return }
    if (k === 'ArrowRight') { event.preventDefault(); move(sel.row, sel.col + 1); return }
    if (k === 'Tab') {
      event.preventDefault()
      if (event.shiftKey && atOrigin()) leaveGrid()
      else nextCell(event.shiftKey)
      return
    }
    if (k === ' ') { event.preventDefault(); beginEdit(); return }
    if (k === 'Backspace' || k === 'Delete') {
      event.preventDefault()
      if (kinds[sel.col] === 'toggle') return
      patch(sel.row, write(rows[sel.row], sel.col, ''))
      return
    }
    if (k.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); beginEdit(k) }
  }

  /** Keys inside an open text editor. */
  const onEditKey = (event: KeyboardEvent<HTMLInputElement>, repeat: (row: R) => Partial<R>) => {
    // The input sits inside the grid: without this the grid handler would run
    // again on the state this one just changed, acting twice on one key.
    event.stopPropagation()
    const k = event.key
    const input = event.currentTarget

    if (k === 'Escape') { event.preventDefault(); setMode(false); return }

    if (kinds[sel.col] === 'number' && step && (k === 'ArrowUp' || k === 'ArrowDown') && (event.ctrlKey || event.shiftKey)) {
      event.preventDefault()
      const delta = (k === 'ArrowUp' ? 1 : -1) * step(rows[sel.row], sel.col, event.shiftKey)
      const value = Math.max(0, (Number(String(input.value).replace(',', '.')) || 0) + delta)
      // Whole steps stay whole; fractional ones keep at most three decimals.
      input.value = Number.isInteger(delta) && Number.isInteger(value)
        ? String(value)
        : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
      return
    }

    const commit = () => patch(sel.row, write(rows[sel.row], sel.col, input.value))

    if (k === 'Tab') { event.preventDefault(); commit(); nextCell(event.shiftKey); return }
    if (k === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); repeatRow(sel.row, repeat(rows[sel.row])); return }
    if (k === 'Enter') { event.preventDefault(); commit(); advance() }
  }

  /** Parks the cursor, so reopening does not resume mid-edit. */
  const reset = useCallback(() => {
    setMode(false)
    setSel({ row: 0, col: 0 })
    setFilter('')
    touched.current = false
    setEntered(false)
  }, [])

  const cellKey = (r: number, c: number) => `${r}:${c}`
  const bandAnchor = () => cellRefs.current.get(cellKey(sel.row, sel.col)) ?? gridRef.current!

  return {
    sel, setSel, mode, setMode, listIdx, setListIdx, filter, setFilter,
    gridRef, editRef, cellRefs, discard, touched, entered, enter, onGridFocus,
    bands: bandList, bandAnchor, cellKey,
    patch, withBlank, move, nextCell, beginEditAt, beginEdit, commitLive,
    completeRow, advance, repeatRow, removeRow, pickBand, atOrigin, leaveGrid, reset,
    onGridKey, onEditKey,
  }
}
