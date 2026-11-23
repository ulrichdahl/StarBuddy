import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

/** Where help opens when the client is not paired with a server yet. */
const PUBLIC_SITE = "https://starbuddy.uniteddanes.org";

/** Opens a help topic (/help/<topic>) on the paired server's website, or the public one, in the window's language. */
export async function openHelp(topic: string, lang: string) {
  const conn = await invoke<{ paired: boolean; server_url: string }>("get_connection").catch(() => null);
  const site = (conn?.paired && conn.server_url ? conn.server_url : PUBLIC_SITE).replace(/\/+$/, "");
  await openUrl(`${site}/help/${topic}?lang=${lang}`).catch(() => {});
}

/**
 * The "?" that opens a help topic: in the window header for the section, and
 * beside a card's heading where the card has a topic of its own.
 */
export function HelpButton({ topic, className = "" }: { topic: string | (() => string); className?: string }) {
  const { t, i18n } = useTranslation();
  const open = () => void openHelp(typeof topic === "function" ? topic() : topic, i18n.language);
  return (
    <button type="button" className={`sb-hd-x sb-help ${className}`.trim()} aria-label={t("shell.help")} title={t("shell.help")} onClick={open}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 3.8" />
        <path d="M12 17h.01" />
      </svg>
    </button>
  );
}
