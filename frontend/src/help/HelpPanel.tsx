import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { fonts, hud } from '../theme'
import { HELP_GROUPS, HELP_TOPICS, helpDoc } from './content'
import { HelpArticle } from './HelpArticle'

export const HELP_PANEL_WIDTH = 520

/**
 * The help, slid in from the right over the page. It does not block the page,
 * so you can follow the steps while reading them.
 */
export function HelpPanel({ topic, onTopic, onClose }: { topic: string; onTopic: (id: string) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const doc = helpDoc(topic, i18n.language)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [topic])

  // Every topic's title, for the picker.
  const titles = Object.fromEntries(HELP_TOPICS.map((h) => [h.id, helpDoc(h.id, i18n.language)?.title ?? h.id]))

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      sx={{
        '& .MuiDrawer-paper': {
          width: { xs: '100%', sm: HELP_PANEL_WIDTH },
          top: 64,
          height: 'calc(100% - 64px)',
          bgcolor: hud.panel,
          borderLeft: `1px solid ${hud.lineStrong}`,
          boxShadow: '-24px 0 48px rgba(0,0,0,0.45)',
        },
      }}
      role="complementary"
      aria-label={t('help.title')}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: `1px solid ${hud.lineSoft}` }}>
        <TextField
          select
          size="small"
          label={t('help.title')}
          value={topic}
          onChange={(e) => onTopic(e.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {HELP_GROUPS.flatMap((group) => [
            <ListSubheader key={`g-${group}`}>{t(`help.groups.${group}`)}</ListSubheader>,
            ...HELP_TOPICS.filter((h) => h.group === group).map((h) => (
              <MenuItem key={h.id} value={h.id}>
                {titles[h.id]}
              </MenuItem>
            )),
          ])}
        </TextField>
        <Tooltip title={t('help.openFull')}>
          <IconButton aria-label={t('help.openFull')} href={`/help/${topic}`} target="_blank" rel="noopener">
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('common.close')}>
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Box ref={scroller} sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5 }}>
        {doc && (
          <>
            <Typography component="h2" sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, color: hud.text, mb: 1.5 }}>
              {doc.title}
            </Typography>
            <HelpArticle doc={doc} dense onTopic={onTopic} topicHref={(id) => `/help/${id}`} />
          </>
        )}
      </Box>
    </Drawer>
  )
}
