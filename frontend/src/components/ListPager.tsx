import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Pagination from '@mui/material/Pagination'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'

interface ListPagerProps {
  total: number
  /** Zero-based, like TablePagination. */
  page: number
  rowsPerPage: number
  onPageChange: (page: number) => void
  onRowsPerPageChange: (rows: number) => void
  rowsPerPageOptions?: number[]
}

/**
 * The list footer every table gets: rows per page, a direct page field,
 * numbered pages with previous/next, and the visible range.
 */
export function ListPager({
  total,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPageOptions = [25, 50, 100, 200],
}: ListPagerProps) {
  const { t, i18n } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / rowsPerPage))
  const [draft, setDraft] = useState(String(page + 1))
  useEffect(() => setDraft(String(page + 1)), [page])

  const commit = () => {
    const n = Number.parseInt(draft, 10)
    if (Number.isFinite(n)) onPageChange(Math.min(pages, Math.max(1, n)) - 1)
    else setDraft(String(page + 1))
  }
  const lo = total === 0 ? 0 : page * rowsPerPage + 1
  const hi = Math.min(total, (page + 1) * rowsPerPage)

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, px: 2, py: 1, flexWrap: 'wrap', borderTop: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption">{t('pager.rowsPerPage')}</Typography>
        <TextField
          select
          size="small"
          variant="standard"
          value={rowsPerPage}
          onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
          slotProps={{ select: { 'aria-label': t('pager.rowsPerPage') } }}
        >
          {rowsPerPageOptions.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption">{t('pager.page')}</Typography>
        <TextField
          size="small"
          variant="standard"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': t('pager.page'), style: { width: 40, textAlign: 'center' } } }}
        />
        <Typography variant="caption">{t('pager.of', { pages })}</Typography>
      </Box>
      <Pagination
        sx={{ ml: 'auto' }}
        count={pages}
        page={page + 1}
        onChange={(_, p) => onPageChange(p - 1)}
        color="primary"
        size="small"
        siblingCount={1}
        boundaryCount={1}
      />
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {t('pager.range', {
          lo: lo.toLocaleString(i18n.language),
          hi: hi.toLocaleString(i18n.language),
          total: total.toLocaleString(i18n.language),
        })}
      </Typography>
    </Box>
  )
}
