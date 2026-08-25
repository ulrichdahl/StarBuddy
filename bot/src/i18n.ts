import { readFileSync, readdirSync } from "node:fs";
import type { ChatInputCommandInteraction } from "discord.js";
import { backend } from "./lib/backend.js";

/**
 * Reply localization. One JSON file per language in ../locales (English is
 * the fallback). A member's language is the one chosen on the StarBuddy
 * website when they are registered, otherwise the language of their
 * Discord client. Game data (org names, handles) is never translated.
 */
type Messages = Record<string, unknown>;

const localesDir = new URL("../locales/", import.meta.url);
const messages = new Map<string, Messages>();
for (const file of readdirSync(localesDir)) {
  if (file.endsWith(".json")) {
    messages.set(file.slice(0, -5), JSON.parse(readFileSync(new URL(file, localesDir), "utf8")) as Messages);
  }
}

export const SUPPORTED_LOCALES = [...messages.keys()];
export const DEFAULT_LOCALE = "en";

/** "da", "en-GB" → a supported locale, else the default. */
export function normalizeLocale(value: string | null | undefined): string {
  const short = (value ?? "").toLowerCase().split("-")[0] ?? "";
  return messages.has(short) ? short : DEFAULT_LOCALE;
}

function lookup(locale: string, key: string): string | undefined {
  let node: unknown = messages.get(locale);
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function t(locale: string, key: string, vars: Record<string, string | number> = {}): string {
  const plural = typeof vars["count"] === "number" ? (vars["count"] === 1 ? "_one" : "_other") : "";
  const text =
    lookup(locale, key + plural) ??
    lookup(DEFAULT_LOCALE, key + plural) ??
    lookup(locale, key) ??
    lookup(DEFAULT_LOCALE, key) ??
    key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ""));
}

/** Discord locale → { da: "…" } map for command/option description localizations. */
export function descriptions(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const text = lookup(locale, key);
    if (text) out[locale] = text;
  }
  return out;
}

// Registered members' website language, cached briefly per Discord user so
// a command doesn't cost an extra backend round-trip every time.
const profileLocales = new Map<string, { locale: string | null; until: number }>();
const PROFILE_TTL_MS = 5 * 60 * 1000;

export async function resolveLocale(interaction: ChatInputCommandInteraction): Promise<string> {
  const id = interaction.user.id;
  const cached = profileLocales.get(id);
  let profile = cached && cached.until > Date.now() ? cached.locale : undefined;
  if (profile === undefined) {
    try {
      const member = await backend.member(id);
      profile = member.registered ? (member.locale ?? null) : null;
    } catch {
      profile = null;
    }
    profileLocales.set(id, { locale: profile, until: Date.now() + PROFILE_TTL_MS });
  }
  return normalizeLocale(profile ?? interaction.locale);
}
