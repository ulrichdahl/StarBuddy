import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** How long a combination has to be held before it is taken. */
const HOLD_MS = 4000;

/**
 * A keyboard combination, as the global-shortcut plugin spells one.
 *
 * Modifiers in a fixed order, so the same keys always produce the same string
 * and a combination can be compared with the one already saved.
 */
function accelerator(event: KeyboardEvent): string | null {
  const key = mainKey(event);
  if (key === null) return null;
  const parts = [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean) as string[];
  parts.push(key);
  return parts.join("+");
}

/** The one key in a combination that is not a modifier. */
function mainKey(event: KeyboardEvent): string | null {
  const code = event.code;
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)) return null;
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.replace("Numpad", "Numpad");
  const named: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "Minus",
    Equal: "Equal",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Backslash: "Backslash",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    Backquote: "Backquote",
  };
  return named[code] ?? null;
}

/**
 * Set a hotkey by holding it.
 *
 * Typing an accelerator meant knowing how the plugin spells one, and a
 * mistyped name is a hotkey that silently never fires. Holding the keys says
 * exactly what will be registered — and the four seconds are what stops a
 * combination being taken while it is still being assembled, since a hand
 * reaching for Ctrl+Shift+F8 passes through Ctrl+Shift and Ctrl+Shift+F on
 * the way.
 */
export function HotkeyCapture({
  action,
  label,
  current,
  failed,
  onCapture,
}: {
  action: string;
  label: string;
  current: string;
  failed?: string;
  onCapture: (action: string, hotkey: string) => void;
}) {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  const [combination, setCombination] = useState<string | null>(null);
  const [held, setHeld] = useState(0);
  const since = useRef<number | null>(null);

  const stop = useCallback(() => {
    setListening(false);
    setCombination(null);
    setHeld(0);
    since.current = null;
  }, []);

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === "Escape") return stop();
      const next = accelerator(event);
      // Modifiers alone are a combination on the way to being one, not one
      // that can be registered.
      if (next === null) return;
      setCombination((held) => {
        if (held !== next) since.current = performance.now();
        return next;
      });
    };

    // Letting go is what says the hand moved, so the hold starts again.
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      since.current = null;
      setHeld(0);
      setCombination(null);
    };

    const tick = window.setInterval(() => {
      if (since.current === null) return setHeld(0);
      const elapsed = performance.now() - since.current;
      setHeld(Math.min(1, elapsed / HOLD_MS));
    }, 50);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stop);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    };
  }, [listening, stop]);

  // Held long enough: take it. Done here rather than in the timer so the
  // combination and the bar are whatever the last render saw.
  useEffect(() => {
    if (held >= 1 && combination) {
      onCapture(action, combination);
      stop();
    }
  }, [held, combination, action, onCapture, stop]);

  return (
    <div className="hotkey" role="group" aria-label={label}>
      {/* What the key does, and what it currently is. The button used to be
          the only thing on the row, showing a bare "F8" that said nothing
          about which of the four it was or that it could be changed. */}
      <span className="hotkey-what">
        {label}
        {" · "}
        {current ? (
          <kbd>{current}</kbd>
        ) : (
          <span className="hotkey-none">{t("overlay.hotkeyNone")}</span>
        )}
      </span>
      <button className={listening ? "active" : undefined} onClick={() => (listening ? stop() : setListening(true))}>
        {listening ? t("overlay.hotkeyListening") : current ? t("overlay.hotkeyChange") : t("overlay.hotkeyUnset")}
      </button>
      {listening && (
        <div className="hotkey-hold">
          <div className="hotkey-hold-track">
            <div className="hotkey-hold-fill" style={{ width: `${Math.round(held * 100)}%` }} />
          </div>
          <span className="hint">
            {combination
              ? t("overlay.hotkeyHold", { keys: combination, seconds: Math.ceil((1 - held) * (HOLD_MS / 1000)) })
              : t("overlay.hotkeyPress")}
          </span>
        </div>
      )}
      {!listening && failed && <span className="error hotkey-failed">{failed}</span>}
    </div>
  );
}
