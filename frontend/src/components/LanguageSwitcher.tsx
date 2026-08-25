import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import LanguageIcon from '@mui/icons-material/Language'
import { api } from '../lib/api'
import { LOCALE_NAMES, SUPPORTED_LOCALES, currentLocale, setLocale, type Locale } from '../i18n'

/**
 * Language menu. Switches immediately and remembers the choice in the
 * browser; when signed in it is also stored on the profile so it follows
 * the member to other devices.
 */
export function LanguageSwitcher({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const active = currentLocale()

  const persist = useMutation({
    mutationFn: async (locale: Locale) => api.patch('/api/me', { locale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  const choose = (locale: Locale) => {
    setLocale(locale)
    if (signedIn) persist.mutate(locale)
    setAnchor(null)
  }

  return (
    <>
      <Tooltip title={t('common.language')}>
        <IconButton aria-label={t('common.language')} onClick={(e) => setAnchor(e.currentTarget)} size="small">
          <LanguageIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {SUPPORTED_LOCALES.map((locale) => (
          <MenuItem key={locale} selected={locale === active} onClick={() => choose(locale)} lang={locale}>
            {LOCALE_NAMES[locale]}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
