import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Whether this player is a tester, the only players who may send scan
 * training frames. False until the server has said otherwise, so the training
 * rows stay hidden rather than flash up and vanish.
 */
export function useTester(): boolean {
  const [tester, setTester] = useState(false);
  useEffect(() => {
    invoke<boolean>("tester_status")
      .then(setTester)
      .catch(() => setTester(false));
    // The desktop asks the server in its own time, and again after pairing.
    const sub = listen<boolean>("tester-changed", (e) => setTester(e.payload)).catch(() => () => {});
    return () => void sub.then((un) => un());
  }, []);
  return tester;
}
