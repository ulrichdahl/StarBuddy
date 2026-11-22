import { createContext, useContext } from 'react'

export interface HelpState {
  /** The topic in the panel, or null when it is closed. */
  topic: string | null
  /** Open the panel: on the given topic, or on the help for the page you are on. */
  open: (topic?: string) => void
  close: () => void
}

export const HelpContext = createContext<HelpState | null>(null)

/** The help panel's state, or null outside the signed-in app. */
export function useHelp() {
  return useContext(HelpContext)
}
