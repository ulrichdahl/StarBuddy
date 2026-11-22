import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Link from '@mui/material/Link'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LoginIcon from '@mui/icons-material/Login'
import { Wordmark } from '../components/BrandMark'
import { FanSiteFooter } from '../components/FanSiteFooter'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { fonts, gridBackground, hud } from '../theme'
import { DEFAULT_TOPIC, HELP_GROUPS, HELP_TOPICS, helpDoc, isTopic } from './content'
import { HelpArticle } from './HelpArticle'

const NAV_WIDTH = 280

/**
 * The public help at /help/<topic>: no sign-in needed, so a new member can
 * read how StarBuddy works before joining, and a link can be shared.
 */
export function HelpSite({ signedIn }: { signedIn: boolean }) {
  const { t, i18n } = useTranslation()
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))

  const asked = pathname.split('/')[2]
  const topic = isTopic(asked) ? asked : DEFAULT_TOPIC
  const doc = helpDoc(topic, i18n.language)
  const go = (id: string) => navigate(`/help/${id}`)
  const titles = Object.fromEntries(HELP_TOPICS.map((h) => [h.id, helpDoc(h.id, i18n.language)?.title ?? h.id]))
  const index = HELP_TOPICS.findIndex((h) => h.id === topic)
  const previous = HELP_TOPICS[index - 1]
  const next = HELP_TOPICS[index + 1]

  useEffect(() => {
    document.title = doc ? `${doc.title} · ${t('help.title')} · StarBuddy` : 'StarBuddy'
  }, [doc, t])
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
    else window.scrollTo({ top: 0 })
  }, [topic, hash])

  const nav = (
    <Box component="nav" aria-label={t('help.contents')}>
      {HELP_GROUPS.map((group) => (
        <Box key={group} sx={{ mb: 2.5 }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: hud.textFaint, px: 1.5, mb: 0.75 }}
          >
            {t(`help.groups.${group}`)}
          </Typography>
          {HELP_TOPICS.filter((h) => h.group === group).map((h) => (
            <ButtonBase
              key={h.id}
              component="a"
              href={`/help/${h.id}`}
              onClick={(e: React.MouseEvent) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) return
                e.preventDefault()
                go(h.id)
              }}
              aria-current={h.id === topic ? 'page' : undefined}
              sx={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                px: 1.5,
                py: 0.75,
                fontSize: 15,
                color: h.id === topic ? hud.teal : hud.textSoft,
                bgcolor: h.id === topic ? hud.tealWash : 'transparent',
                borderLeft: `2px solid ${h.id === topic ? hud.teal : 'transparent'}`,
                '&:hover': { color: hud.text, bgcolor: hud.hover },
              }}
            >
              {titles[h.id]}
            </ButtonBase>
          ))}
        </Box>
      ))}
    </Box>
  )

  return (
    <Box sx={{ minHeight: '100vh', ...gridBackground }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 2, minHeight: { xs: 64 }, px: { xs: 1.5, sm: 2.5 } }}>
          <Link href="/" underline="none" sx={{ display: 'flex', alignItems: 'center', gap: 1 }} aria-label="StarBuddy">
            <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: 32, height: 32 }} />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              <Wordmark variant="h6" />
            </Box>
          </Link>
          <Typography component="span" sx={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase', color: hud.textMuted }}>
            {t('help.title')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
            <LanguageSwitcher signedIn={signedIn} />
            <Button variant="contained" href="/" aria-label={signedIn ? t('help.openApp') : t('login.signIn')} startIcon={signedIn ? undefined : <LoginIcon />} sx={{ whiteSpace: 'nowrap', '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } } }}>
              <Box component="span" sx={{ display: { xs: signedIn ? 'inline' : 'none', sm: 'inline' } }}>
                {signedIn ? t('help.openApp') : t('login.signIn')}
              </Box>
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {wide && (
          <Box sx={{ width: NAV_WIDTH, flexShrink: 0, position: 'sticky', top: 64, maxHeight: 'calc(100vh - 64px)', overflowY: 'auto', py: 3, px: 1.5, borderRight: `1px solid ${hud.lineSoft}`, bgcolor: hud.nav }}>
            {nav}
          </Box>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, md: 5 }, py: { xs: 2.5, md: 4 } }}>
          {!wide && (
            <TextField select fullWidth size="small" label={t('help.contents')} value={topic} onChange={(e) => go(e.target.value)} sx={{ mb: 3 }}>
              {HELP_GROUPS.flatMap((group) => [
                <ListSubheader key={`g-${group}`}>{t(`help.groups.${group}`)}</ListSubheader>,
                ...HELP_TOPICS.filter((h) => h.group === group).map((h) => (
                  <MenuItem key={h.id} value={h.id}>
                    {titles[h.id]}
                  </MenuItem>
                )),
              ])}
            </TextField>
          )}
          {doc && (
            <Box component="article">
              <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
                {doc.title}
              </Typography>
              <HelpArticle doc={doc} onTopic={go} topicHref={(id) => `/help/${id}`} />
            </Box>
          )}
          <Box component="nav" aria-label={t('help.moreTopics')} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 5, pt: 2.5, borderTop: `1px solid ${hud.lineSoft}`, flexWrap: 'wrap' }}>
            {previous ? (
              <Button startIcon={<ArrowBackIcon />} href={`/help/${previous.id}`} onClick={(e) => { e.preventDefault(); go(previous.id) }}>
                {titles[previous.id]}
              </Button>
            ) : <span />}
            {next && (
              <Button endIcon={<ArrowForwardIcon />} href={`/help/${next.id}`} onClick={(e) => { e.preventDefault(); go(next.id) }}>
                {titles[next.id]}
              </Button>
            )}
          </Box>
          <FanSiteFooter />
        </Box>
      </Box>
    </Box>
  )
}
