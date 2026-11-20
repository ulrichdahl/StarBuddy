import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Changes } from "./types";

/** What changed in this build, folded away under the panels. */
export function ChangesPanel() {
  const { t } = useTranslation();
  const [changes, setChanges] = useState<Changes | null>(null);

  useEffect(() => {
    // No change list to show is not worth a word on screen.
    invoke<Changes>("app_changes").then(setChanges).catch(() => {});
  }, []);

  if (!changes || (changes.summary.length === 0 && changes.commits.length === 0)) return null;

  return (
    <details className="panel changes">
      <summary>
        {changes.channel === "dev"
          ? t("changes.sinceLive", { count: changes.commits.length, version: (changes.since ?? "").replace(/^v/, "") })
          : t("changes.inVersion", { version: changes.version })}
      </summary>
      {changes.summary.length > 0 && (
        <>
          {changes.channel === "dev" && <p className="hint">{t("changes.summaryHint")}</p>}
          <ul>
            {changes.summary.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {changes.commits.length > 0 && (
        <>
          <p className="hint">{t("changes.commitsHint")}</p>
          <ul className="mono commits">
            {changes.commits.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
