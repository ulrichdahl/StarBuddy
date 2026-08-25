import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import da from './locales/da.json'
import en from './locales/en.json'

/**
 * UI localization. One JSON file per language in ./locales; English is the
 * fallback. Game data (item, material, blueprint, location, manufacturer
 * names, stat mode names) is never translated — it comes from the API as-is.
 */
export const SUPPORTED_LOCALES = ['en', 'da'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', da: 'Dansk' }

const STORAGE_KEY = 'starbuddy.locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Browser preference: first Accept-Language entry we support, else English. */
export function browserLocale(): Locale {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const short = lang.toLowerCase().split('-')[0]
    if (isLocale(short)) return short
  }
  return 'en'
}

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isLocale(v) ? v : null
  } catch {
    return null
  }
}

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : 'en'
}

/** Switch the UI language and remember it in this browser. */
export function setLocale(locale: Locale): void {
  if (i18n.language !== locale) void i18n.changeLanguage(locale)
  document.documentElement.lang = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // private mode — the profile still remembers it
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, da: { translation: da } },
  lng: storedLocale() ?? browserLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})
document.documentElement.lang = i18n.language

export default i18n
