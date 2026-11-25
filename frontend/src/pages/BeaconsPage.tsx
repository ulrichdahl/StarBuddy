import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import { visuallyHidden } from '@mui/utils'
import { api, apiErrorDetail } from '../lib/api'
import { beaconBody, beaconFile, shortShard } from '../lib/beacons'
import type { Beacon, CurrentShard } from '../lib/types'
import { PageHeader } from '../components/PageHeader'
import { EmptyRow } from '../components/EmptyState'
import { hud, fonts } from '../theme'

interface ImportResult {
  data: Beacon[]
  current_shard: string | null
  other_shard: number[]
}

const BEACONS_KEY = ['beacons']

/** A beacon's name, renamed in place: click the pencil, Enter keeps it, Escape drops it. */
function NameCell({ beacon, onRename }: { beacon: Beacon; onRename: (name: string) => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(beacon.name)

  if (!editing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box component="span" sx={{ fontWeight: 600 }}>
          {beacon.name}
        </Box>
        {beacon.mine && (
          <Tooltip title={t('beacons.rename')}>
            <IconButton
              size="small"
              aria-label={t('beacons.renameAria', { name: beacon.name })}
              onClick={() => {
                setValue(beacon.name)
                setEditing(true)
              }}
            >
              <EditOutlinedIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    )
  }

  const commit = () => {
    const name = value.trim()
    setEditing(false)
    if (name && name !== beacon.name) onRename(name)
  }
  return (
    <TextField
      size="small"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      slotProps={{ htmlInput: { maxLength: 80, 'aria-label': t('beacons.columns.name') } }}
      sx={{ minWidth: 200 }}
    />
  )
}

export function BeaconsPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState<Beacon | null>(null)
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const beacons = useQuery({
    queryKey: BEACONS_KEY,
    queryFn: async () => (await api.get<{ data: Beacon[] }>('/api/beacons')).data.data,
  })
  const shard = useQuery({
    queryKey: ['me', 'shard'],
    queryFn: async () => (await api.get<CurrentShard>('/api/me/shard')).data,
  })
  const rows = beacons.data ?? []

  const refresh = () => queryClient.invalidateQueries({ queryKey: BEACONS_KEY })
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: number; name?: string; shared?: boolean }) => api.patch(`/api/beacons/${id}`, patch),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/beacons/${id}`),
    onSuccess: (_, id) => {
      setDeleting(null)
      setSelected((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    },
    onSettled: refresh,
  })
  const importFile = useMutation({
    mutationFn: async (body: unknown) => (await api.post<ImportResult>('/api/beacons/import', body)).data,
    onSuccess: (result) => {
      setImported(result)
      void refresh()
    },
    onError: (error) => setImportError(apiErrorDetail(error) ?? t('beacons.importFailed')),
  })

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImported(null)
    setImportError(null)
    let body: unknown
    try {
      body = JSON.parse(await file.text())
    } catch {
      setImportError(t('beacons.importNotJson'))
      return
    }
    importFile.mutate(body)
  }

  const exportBeacons = () => {
    const chosen = selected.size > 0 ? rows.filter((b) => selected.has(b.id)) : rows
    const blob = new Blob([JSON.stringify(beaconFile(chosen), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'starbuddy-beacons.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allSelected = rows.length > 0 && rows.every((b) => selected.has(b.id))
  const someSelected = rows.some((b) => selected.has(b.id))

  const elsewhere = imported ? imported.data.filter((b) => imported.other_shard.includes(b.id)) : []
  const current = shard.data?.shard ?? null

  return (
    <Box>
      <PageHeader
        title={t('beacons.title')}
        subtitle={t('beacons.subtitle')}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
            <Button variant="outlined" startIcon={<FileUploadOutlinedIcon />} onClick={() => fileInput.current?.click()} disabled={importFile.isPending}>
              {t('beacons.import')}
            </Button>
            <Button variant="contained" startIcon={<FileDownloadOutlinedIcon />} onClick={exportBeacons} disabled={rows.length === 0}>
              {selected.size > 0 ? t('beacons.exportSelected', { count: selected.size }) : t('beacons.exportAll')}
            </Button>
          </Box>
        }
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
        <Typography variant="body2" sx={{ color: hud.textMuted }}>
          {current
            ? t('beacons.currentShard', {
                shard: shortShard(current),
                full: current,
                at: shard.data?.at ? new Date(shard.data.at).toLocaleString(i18n.language) : '',
              })
            : t('beacons.noShard')}
        </Typography>

        {importError && (
          <Alert severity="error" onClose={() => setImportError(null)}>
            {importError}
          </Alert>
        )}
        {imported && (
          <Alert
            severity={elsewhere.length > 0 ? 'warning' : imported.current_shard ? 'success' : 'info'}
            onClose={() => setImported(null)}
          >
            <Box>{t('beacons.imported', { count: imported.data.length })}</Box>
            {imported.current_shard === null && <Box sx={{ mt: 0.5 }}>{t('beacons.importNoShard')}</Box>}
            {elsewhere.length > 0 && (
              <>
                <Box sx={{ mt: 0.5 }}>{t('beacons.importOtherShard', { count: elsewhere.length, shard: shortShard(imported.current_shard ?? '') })}</Box>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {elsewhere.map((b) => (
                    <li key={b.id}>
                      {b.name} ({b.system ?? t('common.none')}, {t('beacons.shardLabel')} {shortShard(b.shard)})
                    </li>
                  ))}
                </Box>
              </>
            )}
          </Alert>
        )}
        {(update.isError || remove.isError) && <Alert severity="error">{t('beacons.saveFailed')}</Alert>}
      </Box>

      <Paper>
        {beacons.isLoading && <LinearProgress />}
        {beacons.isError && <Alert severity="error">{t('beacons.loadFailed')}</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('beacons.tableAria')}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((b) => b.id)))}
                    slotProps={{ input: { 'aria-label': t('beacons.selectAll') } }}
                  />
                </TableCell>
                <TableCell>{t('beacons.columns.name')}</TableCell>
                <TableCell>{t('beacons.columns.system')}</TableCell>
                <TableCell>{t('beacons.columns.shard')}</TableCell>
                <TableCell>{t('beacons.columns.body')}</TableCell>
                <TableCell>{t('beacons.columns.owner')}</TableCell>
                <TableCell>{t('beacons.columns.setAt')}</TableCell>
                <TableCell>{t('beacons.columns.shared')}</TableCell>
                <TableCell align="right" sx={{ position: 'relative' }}>
                  <Box component="span" sx={visuallyHidden}>
                    {t('common.delete')}
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((b) => {
                const body = beaconBody(b.frame)
                const otherShard = current !== null && b.shard !== current
                return (
                  <TableRow key={b.id} hover selected={selected.has(b.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(b.id)}
                        onChange={() => toggle(b.id)}
                        slotProps={{ input: { 'aria-label': t('beacons.select', { name: b.name }) } }}
                      />
                    </TableCell>
                    <TableCell>
                      <NameCell beacon={b} onRename={(name) => update.mutate({ id: b.id, name })} />
                      {b.location && (
                        <Typography variant="caption" sx={{ color: hud.textDim, display: 'block' }}>
                          {b.location}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{b.system ?? t('common.none')}</TableCell>
                    <TableCell>
                      <Tooltip title={b.shard}>
                        <Box component="span" sx={{ fontFamily: fonts.mono, color: otherShard ? hud.amber : undefined }}>
                          {shortShard(b.shard)}
                        </Box>
                      </Tooltip>
                      {otherShard && (
                        <Typography variant="caption" sx={{ color: hud.amber, display: 'block' }}>
                          {t('beacons.otherShard')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{body ?? t('beacons.space')}</TableCell>
                    <TableCell>{b.mine ? t('beacons.you') : b.owner.name}</TableCell>
                    <TableCell>{new Date(b.set_at).toLocaleString(i18n.language)}</TableCell>
                    <TableCell>
                      {b.mine ? (
                        <Switch
                          size="small"
                          checked={b.shared}
                          onChange={(e) => update.mutate({ id: b.id, shared: e.target.checked })}
                          slotProps={{ input: { 'aria-label': t('beacons.shareAria', { name: b.name }) } }}
                        />
                      ) : (
                        <Typography variant="body2" sx={{ color: hud.textDim }}>
                          {t('beacons.sharedWithYou')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {b.mine && (
                        <Tooltip title={t('common.delete')}>
                          <IconButton size="small" aria-label={t('beacons.deleteAria', { name: b.name })} onClick={() => setDeleting(b)}>
                            <DeleteOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!beacons.isLoading && rows.length === 0 && (
                <EmptyRow colSpan={9} title={t('beacons.emptyTitle')} text={t('beacons.emptyHow')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('beacons.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('beacons.deleteWhat', { name: deleting?.name ?? '' })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
