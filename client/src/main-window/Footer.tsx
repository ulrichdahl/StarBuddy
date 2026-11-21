import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { AppVersion, UpdateCheck, UpdateStatus } from "./types";

/** Fansite notice, credits, the version and the manual update check. */
export function Footer({
  update,
  onUpdate,
  part,
}: {
  /** Home shows the fan-site credit and notice; Settings › Updates the version row. */
  part: "credits" | "updates";
  update: UpdateCheck | null;
  /** A fresh answer from the update check, and whether it offers anything. */
  onUpdate: (info: UpdateCheck, offered: boolean) => void;
}) {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const updateStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<AppVersion>("app_version").then(setAppVersion).catch(() => {});
    return () => {
      if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    };
  }, []);

  const checkForUpdate = async () => {
    if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    setUpdateStatus("checking");
    try {
      const info = await invoke<UpdateCheck>("check_for_update");
      const offered = info.update_available || info.dev_update_available;
      onUpdate(info, offered);
      if (offered) {
        setUpdateStatus("idle");
        return;
      }
      setUpdateStatus("upToDate");
    } catch {
      setUpdateStatus("failed");
    }
    updateStatusTimer.current = setTimeout(() => setUpdateStatus("idle"), 5000);
  };

  if (part === "updates") {
    return (
      <section className="panel">
        <h2>{t("settings.tab.updates")}</h2>
        <p className="hint update-row">
          {appVersion && (
            <span className="mono">
              {appVersion.build
                ? t("update.versionBuild", { version: appVersion.version, build: appVersion.build })
                : t("update.version", { version: appVersion.version })}
            </span>
          )}
          <button className="link-button" onClick={checkForUpdate} disabled={updateStatus === "checking"}>
            {updateStatus === "checking" ? t("update.checking") : t("update.check")}
          </button>
          {updateStatus === "upToDate" && update && <span role="status">{t("update.upToDate", { current: update.current })}</span>}
          {updateStatus === "failed" && <span role="status">{t("update.failed")}</span>}
        </p>
      </section>
    );
  }

  return (
    <footer className="fansite">
      <a href="https://robertsspaceindustries.com/" target="_blank" rel="noopener" aria-label={t("footer.madeByCommunity")}>
        <img src="/made-by-the-community.svg" alt={t("footer.madeByCommunity")} width="64" height="64" />
      </a>
      <div>
        <p className="credit">
          {t("footer.creditPrefix")}{" "}
          <button className="link-button" onClick={() => openUrl("https://uniteddanes.org").catch(() => {})}>United Danes</button>
          {t("footer.creditMiddle")}{" "}
          <button className="link-button" onClick={() => openUrl("https://robertsspaceindustries.com/citizens/RavenMind").catch(() => {})}>RavenMind</button>
          {" "}{t("footer.creditWith")}{" "}
          <button className="link-button" onClick={() => openUrl("https://claude.ai").catch(() => {})}>Claude.ai</button>.
        </p>
        <p>
          {t("footer.disclaimer")}{" "}
          <a href="https://robertsspaceindustries.com/" target="_blank" rel="noopener">robertsspaceindustries.com</a>
        </p>
        <p className="hint">
          {t("footer.trademark")}{" "}
          <a href="https://github.com/ulrichdahl/StarBuddy" target="_blank" rel="noopener">{t("footer.source")}</a>.
        </p>
      </div>
    </footer>
  );
}
