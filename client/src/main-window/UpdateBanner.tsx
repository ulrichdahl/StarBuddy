import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

type InstallProgress = { phase: "downloading"; done: number; total: number | null } | { phase: "installing" };
import type { UpdateCheck } from "./types";

/** "A new version is out", until it is dismissed or acted on. */
export function UpdateBanner({
  update,
  dismissed,
  onDismiss,
}: {
  update: UpdateCheck | null;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  /** Whether this copy can replace itself (Windows, AppImage); else it is downloaded. */
  const [canInstall, setCanInstall] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  useEffect(() => {
    invoke<boolean>("update_can_install").then(setCanInstall).catch(() => {});
  }, []);

  const install = async () => {
    setInstallError(null);
    const onProgress = new Channel<InstallProgress>();
    onProgress.onmessage = setProgress;
    setProgress({ phase: "downloading", done: 0, total: null });
    try {
      // On success the app restarts and this never returns.
      const installed = await invoke<boolean>("update_install", { onProgress });
      if (!installed) setInstallError(t("update.nothingNewer"));
    } catch (e) {
      setInstallError(String(e));
    }
    setProgress(null);
  };
  const progressText =
    progress?.phase === "installing"
      ? t("update.installing")
      : progress
        ? t("update.downloading", { pct: progress.total ? Math.floor((progress.done / progress.total) * 100) : 0 })
        : null;

  // A live update always wins over a dev one.
  const offeredUpdate = update?.update_available ? "release" : update?.dev_update_available ? "dev" : null;
  const openReleasePage = () => {
    const url =
      (offeredUpdate === "dev" ? update?.dev_url : update?.url) || "https://github.com/ulrichdahl/StarBuddy/releases/latest";
    openUrl(url).catch(() => {});
  };

  if (!update || !offeredUpdate || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <div style={{ flex: 1 }}>
        <p>
          {offeredUpdate === "dev"
            ? t("update.devAvailable", { latest: update.latest_dev, current: update.build })
            : t("update.available", { latest: update.latest, current: update.current })}
        </p>
        {(offeredUpdate === "dev" ? update.dev_notes : update.notes) && (
          <details className="update-notes">
            <summary>{t("update.notes")}</summary>
            <pre>{offeredUpdate === "dev" ? update.dev_notes : update.notes}</pre>
          </details>
        )}
        {progressText && <p className="hint">{progressText}</p>}
        {installError && <p className="error">{installError}</p>}
      </div>
      {canInstall && (
        <button disabled={progress !== null} onClick={() => void install()}>
          {t("update.install")}
        </button>
      )}
      <button className={canInstall ? "sb-ghost" : undefined} onClick={openReleasePage}>
        {t("update.download")}
      </button>
      <button
        className="dismiss"
        onClick={onDismiss}
        aria-label={t("update.dismiss")}
        title={t("update.dismiss")}
      >
        ×
      </button>
    </div>
  );
}
