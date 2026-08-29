import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { useMe } from '../lib/auth'
import type { OrgHolding, MatrixMember } from '../lib/types'

export interface OrgMatrixColumn<S extends string> {
  label: string
  /** Sortable when set. */
  field?: S
  align?: 'right' | 'center'
  sx?: SxProps<Theme>
}

export interface OrgMatrixRow {
  key: string
  /** Leading cells — one per `columns` entry. */
  cells: ReactNode[]
  total: number
  stacks: number
  holders: Record<string, OrgHolding>
  /** Row accent (e.g. rarity border colour). */
  sx?: SxProps<Theme>
}

interface OrgMatrixTableProps<S extends string> {
  columns: OrgMatrixColumn<S>[]
  rows: OrgMatrixRow[]
  members: MatrixMember[]
  /** Quantity → display text (units differ per row for materials). */
  format: (row: OrgMatrixRow, quantity: number) => string
  sort: S
  dir: 'asc' | 'desc'
  onSort: (field: S) => void
  loaded: boolean
  emptyText: string
  ariaLabel: string
}

const memberCol = { width: 72, minWidth: 72, maxWidth: 72, px: 0.5 } as const
const meCol = { ...memberCol, bgcolor: 'action.hover' } as const

/**
 * The blueprint matrix, carrying quantities: one row per grouped thing,
 * its org total and stack count, then "You" and one column per org
 * member showing how much they hold (tooltip: in how many stacks).
 */
export function OrgMatrixTable<S extends string>({ columns, rows, members, format, sort, dir, onSort, loaded, emptyText, ariaLabel }: OrgMatrixTableProps<S>) {
  const { t } = useTranslation()
  const { me } = useMe()
  const others = members.filter((m) => m.id !== me?.id)

  const sortHeader = (label: string, field: S | undefined, align?: 'right' | 'center', sx?: SxProps<Theme>) => (
    <TableCell key={label} align={align} sortDirection={field && sort === field ? dir : false} sx={sx}>
      {field ? (
        <TableSortLabel active={sort === field} direction={sort === field ? dir : 'asc'} onClick={() => onSort(field)}>
          {label}
        </TableSortLabel>
      ) : (
        label
      )}
    </TableCell>
  )
  const holding = (row: OrgMatrixRow, member: MatrixMember, mine: boolean) => {
    const h = row.holders[String(member.id)]
    if (!h) return null
    return (
      <Tooltip title={t('org.heldBy', { member: mine ? t('org.you') : member.handle, count: h.stacks })}>
        <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: mine ? 600 : 400 }}>
          {format(row, h.quantity)}
        </Typography>
      </Tooltip>
    )
  }

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" stickyHeader aria-label={ariaLabel}>
        <TableHead>
          <TableRow>
            {columns.map((c) => sortHeader(c.label, c.field, c.align, c.sx))}
            {sortHeader(t('org.total'), 'total' as S, 'right')}
            {sortHeader(t('org.stacks'), 'stacks' as S, 'right')}
            <TableCell align="center" sx={{ ...meCol, verticalAlign: 'bottom' }}>
              <Typography variant="caption" component="span" sx={{ display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 700, color: 'primary.main' }}>
                {t('org.you')}
              </Typography>
            </TableCell>
            {others.map((m) => (
              <TableCell key={m.id} align="center" sx={{ ...memberCol, verticalAlign: 'bottom' }}>
                <Tooltip title={m.handle}>
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}
                  >
                    {m.handle}
                  </Typography>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} hover sx={row.sx}>
              {row.cells.map((cell, i) => (
                <TableCell key={i} align={columns[i]?.align} sx={columns[i]?.sx}>
                  {cell}
                </TableCell>
              ))}
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {format(row, row.total)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                {row.stacks}
              </TableCell>
              <TableCell align="center" sx={meCol}>
                {me && holding(row, { id: me.id, handle: '' }, true)}
              </TableCell>
              {others.map((m) => (
                <TableCell key={m.id} align="center" sx={memberCol}>
                  {holding(row, m, false)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {loaded && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 3 + others.length}>
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  {emptyText}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
