import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { HelpButton } from "./Help";
import type { ConnectionView } from "./types";

/** Where a new player signs in, unless they run their own server. */
export const DEFAULT_SERVER = "https://starbuddy.uniteddanes.org";

interface BrowserStart {
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
}

interface BrowserOutcome {
  state: "done" | "denied" | "expired" | "error";
  message: string | null;
  connection: ConnectionView | null;
}

/**
 * Pairing this client with a StarBuddy server, or the pairing it has.
 *
 * Signing in with the browser is the way in: the website asks the player to
 * approve this machine, and the client shows the code the page shows so the
 * two can be matched. A pairing code typed from the dashboard still works,
 * one click away, for a machine without a browser at hand.
 */
export function ServerPanel({
  connection,
  onConnection,
  bare = false,
}: {
  connection: ConnectionView | null;
  onConnection: (connection: ConnectionView) => void;
  /** Without the panel frame and heading, for the first-run setup. */
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [pairCode, setPairCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<BrowserStart | null>(null);

  useEffect(() => {
    invoke<ConnectionView>("get_connection")
      .then(onConnection)
      .catch((e) => setPairError(String(e)));
    const un = listen<BrowserOutcome>("pair-browser", (e) => {
      setWaiting(null);
      setPairing(false);
      const o = e.payload;
      if (o.state === "done" && o.connection) onConnection(o.connection);
      else if (o.state === "denied") setPairError(t("server.browser.denied"));
      else if (o.state === "expired") setPairError(t("server.browser.expired"));
      else setPairError(o.message ?? t("server.browser.failed"));
    }).catch(() => () => {});
    return () => {
      void un.then((f) => f());
      // Leaving the page mid-sign-in stops the polling with it.
      void invoke("pair_browser_cancel").catch(() => {});
    };
    // Once, on mount: onConnection only hands the answer up.
  }, []);

  const signIn = async () => {
    setPairing(true);
    setPairError(null);
    try {
      setWaiting(await invoke<BrowserStart>("pair_browser_start", { serverUrl }));
    } catch (e) {
      setPairError(String(e));
      setPairing(false);
    }
  };

  const cancel = () => {
    void invoke("pair_browser_cancel").catch(() => {});
    setWaiting(null);
    setPairing(false);
  };

  const pair = async () => {
    setPairing(true);
    setPairError(null);
    try {
      onConnection(await invoke<ConnectionView>("pair_device", { serverUrl, code: pairCode }));
      setPairCode("");
    } catch (e) {
      setPairError(String(e));
    } finally {
      setPairing(false);
    }
  };

  const unpair = () => {
    setPairError(null);
    invoke<ConnectionView>("unpair")
      .then(onConnection)
      .catch((e) => setPairError(String(e)));
  };

  const body = connection?.paired ? (
    <>
      <div className="row">
        <p style={{ flex: 1 }}>
          {t("server.pairedAs")} <strong>{connection.user_name}</strong> · <code>{connection.server_url}</code>
        </p>
        <button onClick={unpair}>{t("server.unpair")}</button>
      </div>
      {pairError && <p className="error">{pairError}</p>}
    </>
  ) : waiting ? (
    <div className="sb-pair-wait">
      <div className="sb-pair-code mono">{waiting.user_code}</div>
      <p>{t("server.browser.approve")}</p>
      <div className="row">
        <button onClick={() => void openUrl(waiting.verification_uri_complete).catch(() => {})}>
          {t("server.browser.openAgain")}
        </button>
        <button className="sb-btn-quiet" onClick={cancel}>
          {t("server.browser.cancel")}
        </button>
      </div>
      <p className="hint">
        <code>{waiting.verification_uri_complete}</code>
      </p>
    </div>
  ) : (
    <>
      <p className="hint">{useCode ? t("server.hint") : t("server.browser.hint")}</p>
      <div className="row">
        <input
          type="text"
          aria-label={t("server.urlLabel")}
          placeholder={t("server.urlPlaceholder")}
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
        {useCode ? (
          <>
            <input
              type="text"
              placeholder={t("server.pairingCodePlaceholder")}
              style={{ maxWidth: 160, flex: "0 1 auto" }}
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
            />
            <button disabled={pairing || !serverUrl || !pairCode} onClick={() => void pair()}>
              {pairing ? t("server.pairing") : t("server.pair")}
            </button>
          </>
        ) : (
          <button className="active" disabled={pairing || !serverUrl} onClick={() => void signIn()}>
            {t("server.browser.signIn")}
          </button>
        )}
      </div>
      <button
        className="sb-link-btn"
        onClick={() => {
          setUseCode(!useCode);
          setPairError(null);
        }}
      >
        {useCode ? t("server.browser.useBrowser") : t("server.browser.useCode")}
      </button>
      {pairError && <p className="error">{pairError}</p>}
    </>
  );

  if (bare) return body;
  return (
    <section className="panel">
      <div className="sb-card-hd">
        <h2>{t("server.title")}</h2>
        <HelpButton topic="client-setup" className="sb-card-help" />
      </div>
      {body}
    </section>
  );
}
