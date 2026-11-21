import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import en from "./locales/en.json";
import da from "./locales/da.json";
import { invoke } from "@tauri-apps/api/core";

export const SUPPORTED_LOCALES = ["en", "da"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  da: "Dansk",
};

const STORAGE_KEY = "starbuddy.locale";
/** Tauri event that tells every window the language was changed in one of them. */
const LOCALE_EVENT = "locale-changed";

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

// The desktop words its own system notifications, so it is told the language
// too. Outside the app (the preview in a browser) there is nothing to tell.
const tellDesktop = (locale: string) => void invoke("ui_locale", { locale }).catch(() => {});
tellDesktop(initialLocale);
i18n.on("languageChanged", tellDesktop);

/** Switch this window's language, if it is not already the one asked for. */
function applyLocale(locale: Locale): void {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export function setLocale(locale: Locale): void {
  applyLocale(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage unavailable; the choice still applies for this session.
  }
  // Every other window open at the time follows. The storage event below
  // does that wherever the webviews share storage events; this does it where
  // they do not. Either one arriving twice changes nothing.
  void emit(LOCALE_EVENT, locale).catch(() => {});
}

// Overlays are separate webviews on the same origin, so they share the stored
// choice — but only read it when they load. These keep an open one in step.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && isLocale(e.newValue)) applyLocale(e.newValue);
});
void listen<string>(LOCALE_EVENT, (e) => {
  if (isLocale(e.payload)) applyLocale(e.payload);
}).catch(() => {
  // Outside Tauri (a plain browser in dev) there are no events to hear; the
  // storage event still covers other tabs.
});

export default i18n;
