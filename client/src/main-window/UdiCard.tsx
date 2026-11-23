import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { HelpButton } from "./Help";

interface UdiStatus {
  linked: boolean;
  auto_install: boolean;
  revision: number | null;
  game_version: string | null;
  installed_at: string | null;
  channel: string | null;
}
interface Profile {
  revision: number;
  channel: string | null;
  labels: boolean;
  config: boolean;
}
interface InstallResult {
  ini: boolean;
  cfg: boolean;
  backed_up: boolean;
  game_version: string | null;
  ini_later: boolean;
}

const POLL_MS = 5_000;
const POLL_FOR_MS = 30 * 60_000;

/**
 * United Danes' StarLabels (ship and item names) and StarConfig (game
 * settings): set up on uniteddanes.org in the browser, installed into the
 * game folder from here (udi.rs).
 */
export function UdiCard() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<UdiStatus | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([invoke<UdiStatus>("udi_status"), invoke<Profile | null>("udi_profile")]);
      setStatus(s);
      setProfile(p);
      autoRef.current = s.auto_install;
      return { s, p };
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await invoke<InstallResult>("udi_install");
      const parts = [
        r.ini && t("udi.doneIni", { version: r.game_version ?? "?" }),
        r.cfg && t("udi.doneCfg"),
        r.backed_up && t("udi.backedUp"),
        r.ini_later && t("udi.iniLater"),
      ].filter(Boolean);
      setDone(parts.length ? parts.join(" ") : t("udi.upToDate"));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  // While the player is on the setup page: look every few seconds for a Send.
  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    const known = status?.revision ?? profile?.revision ?? null;
    const id = setInterval(async () => {
      if (Date.now() - startedAt > POLL_FOR_MS) {
        setWaiting(false);
        return;
      }
      const p = await invoke<Profile | null>("udi_profile").catch(() => null);
      if (p && p.revision !== known) {
        setProfile(p);
        setWaiting(false);
        if (autoRef.current) void install();
      }
    }, POLL_MS);
    return () => clearInterval(id);
    // Started once per setup; the revision known then is the one to beat.
  }, [waiting]);

  const link = async (tool: "labels" | "config") => {
    setError(null);
    try {
      await invoke("udi_link", { lang: i18n.language.slice(0, 2), tool });
      setWaiting(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const unlink = async () => {
    setError(null);
    try {
      await invoke("udi_unlink");
      setProfile(null);
      setDone(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const setAuto = async (enabled: boolean) => {
    try {
      await invoke("udi_auto_set", { enabled });
      autoRef.current = enabled;
      setStatus((s) => (s ? { ...s, auto_install: enabled } : s));
    } catch (e) {
      setError(String(e));
    }
  };

  const fresh = profile !== null && profile.revision !== status?.revision;
  const installedAt = status?.installed_at ? new Date(Number(status.installed_at) * 1000).toLocaleString(i18n.language) : null;

  return (
    <section className="sb-card">
      <div className="sb-card-hd">
        <div className="sb-eyebrow">{t("udi.title")}</div>
        <HelpButton topic="starlabels" className="sb-card-help" />
      </div>
      <p className="sb-card-sub">{t("udi.lead")}</p>

      {status === null ? (
        <p className="sb-card-sub">{t("refinery.loading")}</p>
      ) : (
        <>
          {installedAt && (
            <p className="hint">
              {t("udi.installed", { channel: (status.channel ?? "live").toUpperCase(), version: status.game_version ?? "?", when: installedAt })}
            </p>
          )}
          {fresh && (
            <p>
              {t("udi.fresh", {
                what: [profile.labels && t("udi.whatLabels"), profile.config && t("udi.whatConfig")].filter(Boolean).join(t("udi.and")),
              })}
            </p>
          )}
          {waiting && <p className="hint">{t("udi.waiting")}</p>}
          <div className="row">
            <button type="button" className={fresh || !profile ? "" : "sb-ghost"} onClick={() => void link("labels")}>
              {profile ? t("udi.openLabels") : t("udi.setUp")}
            </button>
            {profile && (
              <button type="button" className="sb-ghost" onClick={() => void link("config")}>
                {t("udi.openConfig")}
              </button>
            )}
            {profile && (
              <button type="button" className={fresh ? "" : "sb-ghost"} disabled={busy} onClick={() => void install()}>
                {fresh ? t("udi.install") : t("udi.reinstall")}
              </button>
            )}
          </div>
          {profile && (
            <label className="sb-check">
              <input type="checkbox" checked={status.auto_install} onChange={(e) => void setAuto(e.target.checked)} />
              {t("udi.auto")}
            </label>
          )}
          {done && <p className="hint">{done}</p>}
          {error && <p className="error">{error}</p>}
          {(profile || status.linked) && (
            <p className="sb-dim">
              {t("udi.note")}{" "}
              <button type="button" className="sb-link" onClick={() => void unlink()}>
                {t("udi.unlink")}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
