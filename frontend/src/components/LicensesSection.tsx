import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

/** One open-source component the website ships (scripts/third-party.mjs). */
interface Component {
  name: string
  version: string
  license: string
  url: string
}
interface ThirdParty {
  npm: Component[]
  composer: Component[]
}

const SOURCE = 'https://github.com/ulrichdahl/StarBuddy'
const CC_BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/'
const OFL = 'https://openfontlicense.org'

/**
 * What StarBuddy uses beyond its own code, each with its maker and license.
 * Names and makers are credits, shown as-is; `key` picks the note under
 * about.licenses.notes.
 */
const CREDITS: { key: string; name: string; by: string; license: string; licenseUrl: string; url: string }[] = [
  {
    key: 'ocr',
    name: 'ocrs text detection and recognition models',
    by: 'Robert Knight',
    license: 'CC BY-SA 4.0',
    licenseUrl: CC_BY_SA,
    url: 'https://github.com/robertknight/ocrs',
  },
  {
    key: 'music',
    name: '“Claimed by the Void”',
    by: 'Vitalezzz',
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    url: 'https://opengameart.org/content/claimed-by-the-void',
  },
  {
    key: 'voiceEn',
    name: 'Ming-3.0-tts-0.5B',
    by: 'inclusionAI',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/license/mit',
    url: 'https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B',
  },
  {
    key: 'voiceDa',
    name: 'Røst-v3-chatterbox-500m',
    by: 'CoRal / the Alexandra Institute',
    license: 'OpenRAIL',
    licenseUrl: 'https://huggingface.co/CoRal-project/roest-v3-chatterbox-500m',
    url: 'https://huggingface.co/CoRal-project/roest-v3-chatterbox-500m',
  },
  { key: 'font', name: 'Rajdhani', by: 'Indian Type Foundry', license: 'SIL OFL 1.1', licenseUrl: OFL, url: 'https://fonts.google.com/specimen/Rajdhani' },
  { key: 'font', name: 'Inter', by: 'Rasmus Andersson', license: 'SIL OFL 1.1', licenseUrl: OFL, url: 'https://rsms.me/inter/' },
  { key: 'font', name: 'JetBrains Mono', by: 'JetBrains', license: 'SIL OFL 1.1', licenseUrl: OFL, url: 'https://www.jetbrains.com/lp/mono/' },
]

function ComponentList({ title, items }: { title: string; items: Component[] }) {
  return (
    <Accordion disableGutters variant="outlined" slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <Table size="small" aria-label={title}>
          <TableBody>
            {items.map((c) => (
              <TableRow key={`${c.name}@${c.version}`} hover>
                <TableCell>
                  <Link href={c.url} target="_blank" rel="noopener">
                    {c.name}
                  </Link>{' '}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {c.version}
                  </Typography>
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{c.license}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AccordionDetails>
    </Accordion>
  )
}

/**
 * About › Licenses: StarBuddy's own license, who made what it uses (the OCR
 * models must be credited under CC BY-SA), and every open-source package the
 * website ships with its license. The package list is generated at build time
 * and loaded only when this section mounts.
 */
export function LicensesSection() {
  const { t } = useTranslation()
  const [parts, setParts] = useState<ThirdParty | null>(null)
  useEffect(() => {
    import('../generated/third-party.json').then((m) => setParts(m.default as ThirdParty)).catch(() => {})
  }, [])

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('about.licenses.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, mb: 2 }}>
        {t('about.licenses.own')}{' '}
        <Link href={`${SOURCE}/blob/main/LICENSE`} target="_blank" rel="noopener">
          GNU AGPL-3.0-or-later
        </Link>
        {' · '}
        <Link href={SOURCE} target="_blank" rel="noopener">
          {t('about.licenses.source')}
        </Link>
      </Typography>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('about.licenses.creditsHeading')}
      </Typography>
      <Box component="ul" sx={{ m: 0, mb: 2, pl: 2.5 }}>
        {CREDITS.map((c) => (
          <Typography component="li" variant="body2" key={c.name} sx={{ mb: 0.5 }}>
            <Link href={c.url} target="_blank" rel="noopener">
              {c.name}
            </Link>{' '}
            {t('about.licenses.by', { by: c.by })} ·{' '}
            <Link href={c.licenseUrl} target="_blank" rel="noopener">
              {c.license}
            </Link>
            <Typography component="span" variant="body2" color="text.secondary">
              {' — '}
              {t(`about.licenses.notes.${c.key}`)}
            </Typography>
          </Typography>
        ))}
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('about.licenses.componentsHeading')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, mb: 1.5 }}>
        {t('about.licenses.componentsHint')}
      </Typography>
      {parts && (
        <Box>
          <ComponentList title={t('about.licenses.npm', { count: parts.npm.length })} items={parts.npm} />
          <ComponentList title={t('about.licenses.composer', { count: parts.composer.length })} items={parts.composer} />
        </Box>
      )}
    </Paper>
  )
}
