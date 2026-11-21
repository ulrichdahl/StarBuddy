import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

/** One open-source component the client ships (scripts/third-party.mjs). */
interface Component {
  name: string;
  version: string;
  license: string;
  url: string;
}
interface ThirdParty {
  rust: Component[];
  npm: Component[];
}

const SOURCE = "https://github.com/ulrichdahl/StarBuddy";

/** What StarBuddy bundles beyond its own code, each with its maker and license. */
const BUNDLED: { key: string; name: string; by: string; license: string; licenseUrl: string; url: string }[] = [
  {
    key: "ocr",
    name: "ocrs text detection and recognition models",
    by: "Robert Knight",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    url: "https://github.com/robertknight/ocrs",
  },
  {
    key: "rajdhani",
    name: "Rajdhani",
    by: "Indian Type Foundry",
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org",
    url: "https://fonts.google.com/specimen/Rajdhani",
  },
  {
    key: "exo2",
    name: "Exo 2",
    by: "Natanael Gama",
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org",
    url: "https://fonts.google.com/specimen/Exo+2",
  },
  {
    key: "mono",
    name: "Share Tech Mono",
    by: "Carrois Apostrophe",
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org",
    url: "https://fonts.google.com/specimen/Share+Tech+Mono",
  },
];

const open = (url: string) => void openUrl(url).catch(() => {});

function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button type="button" className="sb-link" onClick={() => open(url)}>
      {children}
    </button>
  );
}

/**
 * Settings › Credits and licenses: StarBuddy's own license, who made what it
 * bundles (the OCR models must be credited under CC BY-SA), and every
 * open-source component in the build with its license. The component list is
 * generated at build time and loaded only when this tab opens.
 */
export function CreditsPanel() {
  const { t } = useTranslation();
  const [parts, setParts] = useState<ThirdParty | null>(null);
  useEffect(() => {
    import("../generated/third-party.json").then((m) => setParts(m.default as ThirdParty)).catch(() => {});
  }, []);

  const list = (items: Component[]) => (
    <table className="sb-table sb-credits-table">
      <tbody>
        {items.map((c) => (
          <tr key={`${c.name}@${c.version}`}>
            <td>
              <Link url={c.url}>{c.name}</Link> <span className="mono sb-dim">{c.version}</span>
            </td>
            <td className="sb-muted">{c.license}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <section className="panel">
        <h2>{t("credits.title")}</h2>
        <p>{t("credits.made")}</p>
        <p>
          {t("credits.license")} <Link url={`${SOURCE}/blob/main/LICENSE`}>GNU AGPL-3.0</Link> ·{" "}
          <Link url={SOURCE}>{t("credits.source")}</Link>
        </p>
        <p className="hint">{t("credits.trademark")}</p>
      </section>
      <section className="panel">
        <h2>{t("credits.bundled")}</h2>
        {BUNDLED.map((b) => (
          <p key={b.key} className="sb-credit">
            <Link url={b.url}>{b.name}</Link> {t("credits.by", { by: b.by })} · <Link url={b.licenseUrl}>{b.license}</Link>
            {b.key === "ocr" && <span className="hint"> {t("credits.ocrNote")}</span>}
          </p>
        ))}
        <p className="hint">{t("credits.data")}</p>
      </section>
      <section className="panel">
        <h2>{t("credits.components")}</h2>
        <p className="hint">{t("credits.componentsHint")}</p>
        {parts && (
          <>
            <details>
              <summary>{t("credits.rust", { count: parts.rust.length })}</summary>
              {list(parts.rust)}
            </details>
            <details>
              <summary>{t("credits.npm", { count: parts.npm.length })}</summary>
              {list(parts.npm)}
            </details>
          </>
        )}
      </section>
    </>
  );
}
