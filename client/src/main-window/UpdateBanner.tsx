import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
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
      </div>
      <button onClick={openReleasePage}>{t("update.download")}</button>
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
