import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
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
import { PageHeader } from '../components/PageHeader'

/** External services the backend, bot and desktop client talk to. Game data, shown as-is. */
const SOURCES: { key: string; name: string; url: string }[] = [
  { key: 'wikiApi', name: 'Star Citizen Wiki API', url: 'https://api.star-citizen.wiki' },
  { key: 'wikiPages', name: 'Star Citizen Wiki (starcitizen.tools)', url: 'https://starcitizen.tools/Ore_quality' },
  { key: 'scTradeTools', name: 'SC Trade Tools', url: 'https://sc-trade.tools' },
  { key: 'rsiStatus', name: 'RSI service status', url: 'https://status.robertsspaceindustries.com/' },
  { key: 'signatures', name: 'Scan-signature reference table', url: 'https://github.com/ulrichdahl/StarBuddy/blob/main/backend/database/data/scan-signatures.json' },
  { key: 'ocrs', name: 'ocrs (on-device OCR)', url: 'https://github.com/robertknight/ocrs' },
  { key: 'discord', name: 'Discord', url: 'https://discord.com/developers/docs' },
]

/** RSI handles of the members who test dev builds and report what breaks. */
const TESTERS = ['FroggyDK', 'PacManiacDk', 'Tjeppit', 'Simon86DK', 'Rimlee']

export function AboutPage() {
  const { t } = useTranslation()

  return (
    <Box>
      <PageHeader title={t('about.title')} subtitle={t('about.subtitle')} />

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t('about.whatTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
          {t('about.whatBody')}
        </Typography>
      </Paper>

      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3, pb: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('about.sourcesTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
            {t('about.sourcesBody')}
          </Typography>
        </Box>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('about.sourcesTitle')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('about.colSource')}</TableCell>
                <TableCell>{t('about.colUsedFor')}</TableCell>
                <TableCell>{t('about.colHow')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {SOURCES.map((s) => (
                <TableRow key={s.key} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <Link href={s.url} target="_blank" rel="noopener">
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>{t(`about.sources.${s.key}.usedFor`)}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top', color: 'text.secondary' }}>{t(`about.sources.${s.key}.how`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t('about.yourDataTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, whiteSpace: 'pre-line' }}>
          {t('about.yourDataBody')}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t('about.testersTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('about.testersBody')}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {TESTERS.map((handle) => (
            <Chip
              key={handle}
              label={handle}
              component="a"
              href={`https://robertsspaceindustries.com/citizens/${handle}`}
              target="_blank"
              rel="noopener"
              clickable
              variant="outlined"
              color="primary"
            />
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t('about.creditsTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, whiteSpace: 'pre-line' }}>
          {t('about.creditsBody')}
        </Typography>
      </Paper>
    </Box>
  )
}
