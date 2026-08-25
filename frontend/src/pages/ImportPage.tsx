import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DownloadIcon from '@mui/icons-material/Download'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined'
import { api } from '../lib/api'
import type { ImportPreview } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

/**
 * CSV resource import: pick a file, preview it server-side (per-row
 * validation), then commit with the token the preview returned.
 */
export function ImportPage() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<ImportPreview>('/api/import/resources/preview', form)
      return data
    },
    onSuccess: setPreview,
  })

  const commitMutation = useMutation({
    mutationFn: async (token: string) =>
      (await api.post('/api/import/resources/commit', { token })).data,
  })

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setPreview(null)
    commitMutation.reset()
    previewMutation.mutate(file)
  }

  // CSV column names are the backend's import contract — shown verbatim.
  const columns = preview?.rows[0] ? Object.keys(preview.rows[0].data) : []

  return (
    <Box>
      <PageHeader
        title={t('import.title')}
        subtitle={t('import.subtitle')}
        action={
          <Link href="/api/import/resources/template" download underline="none">
            <Button variant="outlined" startIcon={<DownloadIcon />}>
              {t('import.downloadTemplate')}
            </Button>
          </Link>
        }
      />

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? t('import.uploading') : t('import.chooseFile')}
          </Button>
          {fileName && (
            <Typography variant="body2" color="text.secondary">
              {fileName}
            </Typography>
          )}
        </Stack>
        {previewMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t('import.previewFailed')}
          </Alert>
        )}
      </Paper>

      {preview && (
        <Paper sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {t('import.preview')}
            </Typography>
            <Chip
              icon={<CheckCircleIcon />}
              label={t('import.validCount', { count: preview.valid_count })}
              color="primary"
              variant="outlined"
              size="small"
            />
            <Chip
              icon={<ErrorOutlinedIcon />}
              label={t('import.errorCount', { count: preview.error_count })}
              color={preview.error_count > 0 ? 'error' : 'default'}
              variant="outlined"
              size="small"
            />
          </Stack>

          <TableContainer sx={{ overflowX: 'auto', mb: 2 }}>
            <Table size="small" aria-label={t('import.previewTable')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('import.line')}</TableCell>
                  {columns.map((col) => (
                    <TableCell key={col}>{col}</TableCell>
                  ))}
                  <TableCell>{t('import.errors')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow
                    key={row.line}
                    sx={row.errors.length > 0 ? { bgcolor: 'rgba(244, 67, 54, 0.08)' } : undefined}
                  >
                    <TableCell>{row.line}</TableCell>
                    {columns.map((col) => (
                      <TableCell key={col}>{row.data[col] ?? ''}</TableCell>
                    ))}
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <Typography variant="caption" color="error">
                          {row.errors.join('; ')}
                        </Typography>
                      ) : (
                        t('common.none')
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {commitMutation.isSuccess ? (
            <Alert severity="success">{t('import.committed')}</Alert>
          ) : (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Button
                variant="contained"
                color="secondary"
                disabled={preview.valid_count === 0 || commitMutation.isPending}
                onClick={() => commitMutation.mutate(preview.token)}
              >
                {commitMutation.isPending
                  ? t('import.importing')
                  : t('import.commitImport', { count: preview.valid_count })}
              </Button>
              {preview.error_count > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('import.errorRowsSkipped')}
                </Typography>
              )}
            </Stack>
          )}
          {commitMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {t('import.commitFailed')}
            </Alert>
          )}
        </Paper>
      )}
    </Box>
  )
}
