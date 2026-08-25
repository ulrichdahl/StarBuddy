import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import da from "./locales/da.json";

export const SUPPORTED_LOCALES = ["en", "da"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  da: "Dansk",
};

const STORAGE_KEY = "starbuddy.locale";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function detectLocale(): Locale {
  const preferred = navigator.languages?.[0] ?? navigator.language ?? "";
  const base = preferred.toLowerCase().split("-")[0];
  return base === "da" ? "da" : "en";
}

const initialLocale: Locale = readStoredLocale() ?? detectLocale();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    da: { translation: da },
  },
  lng: initialLocale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = initialLocale;

export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable; the choice still applies for this session.
  }
  document.documentElement.lang = locale;
}

export default i18n;
