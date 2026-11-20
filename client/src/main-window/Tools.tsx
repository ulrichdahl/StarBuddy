import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { ConnectionView } from "./types";

interface ToolLink {
  name: string;
  url: string;
}

/** Pages of the paired StarBuddy website, by path; the name and blurb are translated. */
const ORG_PAGES: { key: string; path: string }[] = [
  { key: "dashboard", path: "/" },
  { key: "resources", path: "/resources" },
  { key: "items", path: "/items" },
  { key: "blueprints", path: "/blueprints" },
  { key: "craft", path: "/craft" },
  { key: "refinery", path: "/refinery" },
];

/** Community sites players use alongside the game. Names are their own. */
const COMMUNITY: { key: string; name: string; url: string }[] = [
  { key: "uex", name: "UEX", url: "https://uexcorp.space/" },
  { key: "regolith", name: "Regolith", url: "https://regolith.rocks/" },
  { key: "erkul", name: "Erkul", url: "https://www.erkul.games/" },
  { key: "wiki", name: "Star Citizen Wiki", url: "https://starcitizen.tools/" },
  { key: "cstone", name: "Cornerstone", url: "https://finder.cstone.space/" },
  { key: "sctrade", name: "SC Trade Tools", url: "https://sc-trade.tools/" },
];

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function LinkTile({ name, blurb, url, onRemove }: { name: string; blurb: string; url: string; onRemove?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="sb-tile">
      <button type="button" className="sb-tile-open" onClick={() => void openUrl(url).catch(() => {})} title={url}>
        <span className="sb-tile-name">{name}</span>
        <span className="sb-tile-blurb">{blurb}</span>
        <span className="sb-tile-host mono">{host(url)}</span>
      </button>
      {onRemove && (
        <button type="button" className="sb-tile-x" aria-label={t("tools.remove", { name })} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Tools: the org's pages on the paired website, the community's sites and the
 * player's own links, each one click from the game. They open in the browser.
 */
export function Tools({ connection }: { connection: ConnectionView | null }) {
  const { t } = useTranslation();
  const [mine, setMine] = useState<ToolLink[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ToolLink[]>("tool_links_get").then(setMine).catch((e) => setError(String(e)));
  }, []);

  const save = async (links: ToolLink[]) => {
    setError(null);
    try {
      setMine(await invoke<ToolLink[]>("tool_links_set", { links }));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    // A bare site is what people type; the browser needs the scheme.
    const full = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (await save([...mine, { name, url: full }])) {
      setName("");
      setUrl("");
    }
  };

  const server = connection?.paired ? connection.server_url.replace(/\/+$/, "") : null;
  return (
    <div className="sb-page">
      <p className="sb-card-sub">{t("tools.lead")}</p>

      {server && ORG_PAGES.length > 0 && (
        <section className="sb-card">
          <div className="sb-eyebrow">{t("tools.org")}</div>
          <div className="sb-tiles">
            {ORG_PAGES.map((p) => (
              <LinkTile key={p.key} name={t(`tools.page.${p.key}.name`)} blurb={t(`tools.page.${p.key}.blurb`)} url={server + p.path} />
            ))}
          </div>
        </section>
      )}

      <section className="sb-card">
        <div className="sb-eyebrow">{t("tools.community")}</div>
        <div className="sb-tiles">
          {COMMUNITY.map((c) => (
            <LinkTile key={c.key} name={c.name} blurb={t(`tools.site.${c.key}`)} url={c.url} />
          ))}
        </div>
      </section>

      <section className="sb-card">
        <div className="sb-eyebrow">{t("tools.mine")}</div>
        {mine.length > 0 && (
          <div className="sb-tiles">
            {mine.map((l, i) => (
              <LinkTile key={`${l.url}-${i}`} name={l.name} blurb="" url={l.url} onRemove={() => void save(mine.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}
        <form className="sb-addlink" onSubmit={(e) => void add(e)}>
          <input type="text" aria-label={t("tools.name")} placeholder={t("tools.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <input type="text" aria-label={t("tools.url")} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" disabled={!name.trim() || !url.trim()}>
            {t("tools.add")}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
