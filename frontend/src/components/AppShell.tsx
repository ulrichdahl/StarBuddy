import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined'
import DiamondOutlinedIcon from '@mui/icons-material/DiamondOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import SchemaOutlinedIcon from '@mui/icons-material/SchemaOutlined'
import FactoryOutlinedIcon from '@mui/icons-material/FactoryOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { Me } from '../lib/types'
import { fonts, hud } from '../theme'
import { FanSiteFooter } from './FanSiteFooter'
import { displayName } from '../lib/people'
import { HudAvatar } from './hud'
import { LanguageSwitcher } from './LanguageSwitcher'
import { OrgListCard } from './OrgListCard'
import { ProfileDialog } from './ProfileDialog'
import { StatusAlertBanner } from './StatusAlertBanner'
import { UserMenu } from './UserMenu'

const DRAWER_WIDTH = 232
/// Wide enough for the icon and its focus ring, and nothing else. A portrait
/// 1080-wide screen is a normal second monitor, and 232px of mostly-empty
/// navigation is a fifth of it.
const RAIL_WIDTH = 60

interface NavItem {
  key: string
  to: string
  icon: ReactNode
}

// Labels are translation keys under nav.*; groups under nav.group*.
const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  {
    key: 'groupOperations',
    items: [
      { key: 'dashboard', to: '/', icon: <SpaceDashboardOutlinedIcon /> },
      { key: 'craft', to: '/craft', icon: <BuildOutlinedIcon /> },
      { key: 'materials', to: '/resources', icon: <DiamondOutlinedIcon /> },
      { key: 'items', to: '/items', icon: <Inventory2OutlinedIcon /> },
      { key: 'blueprints', to: '/blueprints', icon: <SchemaOutlinedIcon /> },
      { key: 'refinery', to: '/refinery', icon: <FactoryOutlinedIcon /> },
    ],
  },
  {
    key: 'groupSystem',
    items: [
      { key: 'import', to: '/import', icon: <FileDownloadOutlinedIcon /> },
      { key: 'training', to: '/training', icon: <PhotoCameraOutlinedIcon /> },
      { key: 'admin', to: '/admin', icon: <ShieldOutlinedIcon /> },
      { key: 'about', to: '/about', icon: <InfoOutlinedIcon /> },
    ],
  },
]

/** STAR·BUDDY — the logo star beside spaced capitals, the dot in teal. */
function Brand() {
  return (
    <Box
      component={NavLink}
      to="/"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: hud.text }}
    >
      <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: 26, height: 26, display: 'block' }} />
      <Box
        component="span"
        sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, letterSpacing: '0.2em', display: { xs: 'none', sm: 'inline' } }}
      >
        STAR
        <Box component="span" sx={{ color: hud.teal }}>
          ·
        </Box>
        BUDDY
      </Box>
    </Box>
  )
}

/** Header search: jumps to Craft with the term. "/" focuses it from anywhere. */
function ItemSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const term = query.trim()
    if (!term) return
    navigate({ pathname: '/craft', search: `?${new URLSearchParams({ search: term, all: '1' })}` })
  }

  return (
    <Box
      component="form"
      role="search"
      onSubmit={submit}
      sx={{ flex: '1 1 260px', display: { xs: 'none', sm: 'flex' }, justifyContent: 'center', px: 2 }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          width: '100%',
          maxWidth: 520,
          height: 42,
          pl: 1.75,
          pr: 1.5,
          border: `1px solid ${hud.lineStrong}`,
          bgcolor: hud.input,
          color: hud.textDim,
          '&:focus-within': { borderColor: hud.teal },
        }}
      >
        <SearchIcon fontSize="small" />
        <InputBase
          inputRef={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('nav.findItemPlaceholder')}
          inputProps={{ 'aria-label': t('nav.findItem'), 'aria-keyshortcuts': '/' }}
          sx={{ flex: 1, minWidth: 0, fontSize: 14, color: hud.text, '& input:focus-visible': { outline: 'none' } }}
        />
        <Tooltip title={t('nav.searchShortcut')}>
          <Box
            component="kbd"
            sx={{ fontFamily: fonts.mono, fontSize: 11, color: hud.textDim, border: `1px solid ${hud.lineStrong}`, px: 0.875, py: 0.25 }}
          >
            /
          </Box>
        </Tooltip>
      </Box>
    </Box>
  )
}

function NavList({ mini, onNavigate }: { mini: boolean; onNavigate: () => void }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <Box component="nav" aria-label={t('nav.mainNavigation')} sx={{ py: 2.25, display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {NAV_GROUPS.map((group, gi) => (
        <Box key={group.key} sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {mini ? (
            gi > 0 && <Box aria-hidden sx={{ height: '1px', bgcolor: hud.lineSoft, mx: 1.5, my: 1.5 }} />
          ) : (
            <Box
              component="span"
              sx={{
                px: 3,
                pt: gi > 0 ? 2.75 : 0.75,
                pb: 1,
                fontFamily: fonts.display,
                fontWeight: 600,
                fontSize: 12,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: hud.textFaint,
              }}
            >
              {t(`nav.${group.key}`)}
            </Box>
          )}
          {group.items.map((item) => {
            const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
            return (
              <Tooltip key={item.to} title={mini ? t(`nav.${item.key}`) : ''} placement="right">
                <Box
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  aria-label={mini ? t(`nav.${item.key}`) : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: mini ? 'center' : 'flex-start',
                    gap: 1.75,
                    height: 44,
                    px: mini ? 0 : 3,
                    textDecoration: 'none',
                    color: active ? hud.text : hud.textMuted,
                    fontWeight: active ? 500 : 400,
                    bgcolor: active ? hud.selected : 'transparent',
                    boxShadow: active ? `inset 3px 0 0 ${hud.teal}` : 'none',
                    '& svg': { fontSize: 19, color: active ? hud.teal : 'inherit' },
                    '&:hover': { bgcolor: hud.hover, color: hud.text },
                    '&:focus-visible': { outlineOffset: -2 },
                  }}
                >
                  {item.icon}
                  {!mini && t(`nav.${item.key}`)}
                </Box>
              </Tooltip>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

interface AppShellProps {
  me: Me
}

/**
 * Application chrome: header bar with search and the account menu, and the
 * grouped navigation. The navigation is permanent on md-and-up (folding to
 * icons below lg) and an overlay drawer on a phone.
 */
export function AppShell({ me }: AppShellProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  // Below 1200 the navigation shrinks to icons on its own — 1080 wide is a
  // second screen stood on its end, and the width is worth more to the tables.
  const narrow = useMediaQuery(theme.breakpoints.down('lg'))
  // null follows the screen; true or false is the player having said otherwise.
  const [railChoice, setRailChoice] = useState<boolean | null>(null)
  // Crossing the breakpoint hands the decision back to the screen, so a choice
  // made on one monitor does not follow the window to another.
  const [lastNarrow, setLastNarrow] = useState(narrow)
  if (lastNarrow !== narrow) {
    setLastNarrow(narrow)
    setRailChoice(null)
  }
  const rail = railChoice ?? narrow
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [orgsOpen, setOrgsOpen] = useState(false)
  const navWidth = rail ? RAIL_WIDTH : DRAWER_WIDTH

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 2, minHeight: { xs: 64 }, px: { xs: 1.5, sm: 2.5 } }}>
          {/* One button, two jobs: it opens the navigation on a phone and
              folds it to icons on anything wider. */}
          <IconButton
            aria-label={isDesktop ? t('nav.toggleNavigation') : t('nav.openNavigation')}
            onClick={() => (isDesktop ? setRailChoice(!rail) : setMobileOpen(true))}
            sx={{ width: 44, height: 44, color: hud.textSoft, border: '1px solid transparent', '&:hover': { borderColor: '#3d5260' } }}
          >
            <MenuIcon />
          </IconButton>
          <Box component="h1" sx={{ m: 0, display: 'flex', alignItems: 'center' }}>
            <Brand />
          </Box>
          <ItemSearch />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
            <LanguageSwitcher signedIn />
            <Box aria-hidden sx={{ width: '1px', height: 28, bgcolor: hud.lineStrong, mx: 1 }} />
            <ButtonBase
              aria-haspopup="menu"
              aria-expanded={menuAnchor !== null}
              aria-label={t('nav.account')}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                height: 44,
                pl: { xs: 0.75, sm: 1.75 },
                pr: 1,
                color: hud.text,
                border: `1px solid ${menuAnchor ? hud.lineStrong : 'transparent'}`,
                bgcolor: menuAnchor ? hud.input : 'transparent',
                '&:hover': { borderColor: hud.lineStrong },
              }}
            >
              <Box
                component="span"
                sx={{ fontFamily: fonts.display, fontWeight: 600, fontSize: 16, letterSpacing: '0.04em', display: { xs: 'none', sm: 'inline' } }}
              >
                {displayName(me)}
              </Box>
              <HudAvatar me={me} size={32} />
              <ExpandMoreIcon fontSize="small" sx={{ color: hud.textDim }} />
            </ButtonBase>
          </Box>
        </Toolbar>
      </AppBar>

      <UserMenu
        me={me}
        anchor={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenOrganizations={() => setOrgsOpen(true)}
      />
      <ProfileDialog me={me} open={profileOpen} onClose={() => setProfileOpen(false)} />
      <Dialog open={orgsOpen} onClose={() => setOrgsOpen(false)} fullWidth maxWidth="sm" aria-labelledby="orgs-title">
        <DialogTitle id="orgs-title" sx={{ display: 'flex', alignItems: 'center', gap: 2, pr: 2 }}>
          <Box component="span" sx={{ flex: 1 }}>
            {t('org.title')}
          </Box>
          <IconButton aria-label={t('common.close')} onClick={() => setOrgsOpen(false)} sx={{ border: `1px solid ${hud.lineStrong}` }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <OrgListCard me={me} bare />
        </DialogContent>
      </Dialog>

      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: navWidth,
            flexShrink: 0,
            transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
            '& .MuiDrawer-paper': {
              width: navWidth,
              boxSizing: 'border-box',
              overflowX: 'hidden',
              bgcolor: hud.nav,
              transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
            },
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 64 } }} />
          <NavList mini={rail} onNavigate={() => undefined} />
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <Toolbar sx={{ minHeight: { xs: 64 } }} />
          <NavList mini={false} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <Box
        component="main"
        sx={{ flexGrow: 1, px: { xs: 2, md: 4 }, pt: { xs: 2, md: 3.5 }, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Toolbar sx={{ minHeight: { xs: 64 } }} />
        <Box sx={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <StatusAlertBanner />
          <Box sx={{ flex: 1 }}>
            <Outlet />
          </Box>
          <FanSiteFooter />
        </Box>
      </Box>
    </Box>
  )
}
