import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import BuildIcon from '@mui/icons-material/Build'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DiamondIcon from '@mui/icons-material/Diamond'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import SchemaIcon from '@mui/icons-material/Schema'
import FactoryIcon from '@mui/icons-material/Factory'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { Me } from '../lib/types'
import { BrandMark } from './BrandMark'
import { FanSiteFooter } from './FanSiteFooter'
import { LanguageSwitcher } from './LanguageSwitcher'
import { StatusAlertBanner } from './StatusAlertBanner'

const DRAWER_WIDTH = 232

// Labels are translation keys under nav.*
const NAV_ITEMS = [
  { key: 'dashboard', to: '/', icon: <DashboardIcon /> },
  { key: 'craft', to: '/craft', icon: <BuildIcon /> },
  { key: 'materials', to: '/resources', icon: <DiamondIcon /> },
  { key: 'items', to: '/items', icon: <Inventory2Icon /> },
  { key: 'blueprints', to: '/blueprints', icon: <SchemaIcon /> },
  { key: 'refinery', to: '/refinery', icon: <FactoryIcon /> },
  { key: 'import', to: '/import', icon: <UploadFileIcon /> },
  { key: 'admin', to: '/admin', icon: <AdminPanelSettingsIcon /> },
  { key: 'about', to: '/about', icon: <InfoOutlinedIcon /> },
] as const

interface AppShellProps {
  me: Me
}

/**
 * Application chrome: top AppBar + navigation drawer.
 * The drawer is permanent on md-and-up and a temporary overlay on mobile.
 */
export function AppShell({ me }: AppShellProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [itemQuery, setItemQuery] = useState('')
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Global "find an item": jump to Craft with the term, including unowned blueprints.
  const submitItemSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const term = itemQuery.trim()
    if (!term) return
    navigate({ pathname: '/craft', search: `?${new URLSearchParams({ search: term, all: '1' })}` })
  }

  const drawerContent = (
    <Box role="navigation" aria-label={t('nav.mainNavigation')}>
      <Toolbar>
        <BrandMark />
      </Toolbar>
      <List>
        {NAV_ITEMS.map((item) => (
          <ListItem key={item.to} disablePadding>
            <ListItemButton
              component={NavLink}
              to={item.to}
              selected={pathname === item.to}
              onClick={() => setMobileOpen(false)}
              sx={{
                '&.Mui-selected': {
                  borderLeft: 2,
                  borderColor: 'primary.main',
                  bgcolor: 'rgba(91, 200, 219, 0.08)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: pathname === item.to ? 'primary.main' : 'inherit' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={t(`nav.${item.key}`)} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" aria-label={t('nav.openNavigation')} onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Box component="h1" sx={{ m: 0, display: 'flex', alignItems: 'center' }}>
            <BrandMark />
          </Box>
          <Box
            component="form"
            role="search"
            onSubmit={submitItemSearch}
            sx={{ flexGrow: 1, display: { xs: 'none', sm: 'flex' }, justifyContent: 'center', px: 2 }}
          >
            <TextField
              size="small"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder={t('nav.findItemPlaceholder')}
              slotProps={{
                input: {
                  'aria-label': t('nav.findItem'),
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ width: '100%', maxWidth: 320 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {me.handle ?? me.discord_username}
          </Typography>
          <LanguageSwitcher signedIn />
          <Tooltip title={me.discord_username}>
            <Avatar
              src={me.avatar_url ?? undefined}
              alt={me.handle ?? me.discord_username}
              sx={{ width: 32, height: 32 }}
            >
              {(me.handle ?? me.discord_username ?? '?').charAt(0).toUpperCase()}
            </Avatar>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Toolbar />
        <StatusAlertBanner />
        <Box sx={{ flex: 1 }}>
          <Outlet />
        </Box>
        <FanSiteFooter />
      </Box>
    </Box>
  )
}
