import { useEffect, useState } from 'react'

/**
 * The current time, re-read on an interval.
 *
 * Reading `Date.now()` during render is impure: the value is fixed at whatever
 * it was when the component last happened to re-render, so a countdown built on
 * it silently stops. Holding it in state and ticking makes it move, and gives
 * React a stable value within a render.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
