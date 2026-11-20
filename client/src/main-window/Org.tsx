import { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";
import { useServerList } from "./pageParts";
import { environmentName, useGameSession } from "../gameSession";

interface Me {
  handle: string | null;
  main_org_id: number | null;
  /** Active orgs, the main org first. */
  orgs: { id: number; name: string; pivot?: { role: string; status: string } }[];
}
/** GET /api/org/mates, with what each mate's client last reported (presence). */
interface Mate {
  id: number;
  handle: string | null;
  presence: {
    running: boolean;
    environment: string | null;
    branch: string | null;
    shard: string | null;
    location: string | null;
    location_code: string | null;
    ship: string | null;
    character_name: string | null;
    updated_at: string | null;
  } | null;
}

const ago = (iso: string | null, lang: string) => {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (minutes < 60 * 48) return rtf.format(-Math.round(minutes / 60), "hour");
  return rtf.format(-Math.round(minutes / 1440), "day");
};

/** Two people on one shard can meet in the game: the icon says so. */
function SameShard() {
  const { t } = useTranslation();
  return (
    <span className="sb-shard" title={t("org.sameShard")} aria-label={t("org.sameShard")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
      </svg>
    </span>
  );
}

/**
 * Org: the members of the player's main org, and what each is doing in the
 * game — playing or not, where, in what, and whether on the same shard as
 * the player. From what their clients report (presence.rs).
 */
export function Org({ paired }: { paired: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useGameSession();
  const me = useServerList<Me>(paired, "/api/me", {});
  const mates = useServerList<Mate[]>(paired, "/api/org/mates", {});
  const [error, setError] = useState<string | null>(null);

  const setMain = async (orgId: number) => {
    setError(null);
    try {
      await serverApi("PUT", "/api/me/main-org", { body: { org_id: orgId } });
      me.reload();
      mates.reload();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!paired) return <p className="sb-card-sub">{t("pages.pairFirst")}</p>;

  const orgs = me.data?.orgs ?? [];
  const main = orgs.find((o) => o.id === me.data?.main_org_id) ?? orgs[0];
  const myShard = session?.running ? session.shard : null;
  // Playing first, then the most recently seen.
  const rows = [...(mates.data ?? [])].sort(
    (a, b) =>
      Number(Boolean(b.presence?.running)) - Number(Boolean(a.presence?.running)) ||
      (b.presence?.updated_at ?? "").localeCompare(a.presence?.updated_at ?? "") ||
      (a.handle ?? "").localeCompare(b.handle ?? ""),
  );
  const playing = rows.filter((m) => m.presence?.running).length;

  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <p className="sb-card-sub">{main ? t("org.lead", { org: main.name, playing, count: rows.length }) : t("org.noOrg")}</p>
        {orgs.length > 1 && (
          <label className="sb-inline">
            {t("org.main")}{" "}
            <select value={main?.id ?? ""} onChange={(e) => void setMain(Number(e.target.value))}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(error ?? me.error ?? mates.error) && <p className="error">{error ?? me.error ?? mates.error}</p>}
      <section className="sb-card sb-card-list">
        {mates.data === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="sb-card-sub">{t("org.none")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("org.col.member")}</th>
                <th>{t("org.col.status")}</th>
                <th>{t("org.col.location")}</th>
                <th>{t("org.col.ship")}</th>
                <th>{t("org.col.build")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const p = m.presence;
                const you = Boolean(me.data?.handle && m.handle === me.data.handle);
                const together = !you && p?.running && myShard && p.shard === myShard;
                return (
                  <tr key={m.id} className={p?.running ? "" : "sb-row-done"}>
                    <td>
                      {m.handle ?? "—"}
                      {you && <span className="sb-dim"> ({t("org.you")})</span>}
                      {p?.character_name && p.character_name !== m.handle && <span className="sb-dim"> · {p.character_name}</span>}
                    </td>
                    <td>
                      <span className="sb-state">
                        <span className={`sb-dot ${p?.running ? "" : "off"}`} />
                        {p === null ? t("org.unknown") : p.running ? t("org.playing") : t("org.lastSeen", { when: ago(p.updated_at, i18n.language) ?? "—" })}
                        {together && <SameShard />}
                      </span>
                    </td>
                    <td title={p?.location_code ?? undefined}>{p?.location ?? "—"}</td>
                    <td>{p?.ship ?? "—"}</td>
                    <td className="mono sb-muted">
                      {p?.environment ? environmentName(p.environment) : ""} {p?.branch?.replace(/^sc-[a-z]+-/i, "") ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="sb-dim">{t("org.presenceNote")}</p>
      </section>
    </div>
  );
}
