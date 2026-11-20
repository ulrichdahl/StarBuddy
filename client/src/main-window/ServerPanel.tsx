import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ConnectionView } from "./types";

/** Pairing this client with a StarBuddy server, or the pairing it has. */
export function ServerPanel({
  connection,
  onConnection,
}: {
  connection: ConnectionView | null;
  onConnection: (connection: ConnectionView) => void;
}) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ConnectionView>("get_connection")
      .then(onConnection)
      .catch((e) => setPairError(String(e)));
    // Once, on mount: onConnection only hands the answer up.
  }, []);

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

  return (
    <section className="panel">
      <h2>{t("server.title")}</h2>
      {connection?.paired ? (
        <>
          <div className="row">
            <p style={{ flex: 1 }}>
              {t("server.pairedAs")} <strong>{connection.user_name}</strong> ·{" "}
              <code>{connection.server_url}</code>
            </p>
            <button onClick={unpair}>{t("server.unpair")}</button>
          </div>
          {pairError && <p className="error">{pairError}</p>}
        </>
      ) : (
        <>
          <p className="hint">{t("server.hint")}</p>
          <div className="row">
            <input
              type="text"
              placeholder={t("server.urlPlaceholder")}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <input
              type="text"
              placeholder={t("server.pairingCodePlaceholder")}
              style={{ maxWidth: 160, flex: "0 1 auto" }}
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
            />
            <button disabled={pairing || !serverUrl || !pairCode} onClick={pair}>
              {pairing ? t("server.pairing") : t("server.pair")}
            </button>
          </div>
          {pairError && <p className="error">{pairError}</p>}
        </>
      )}
    </section>
  );
}
