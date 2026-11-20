import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { displayName, initials, orgTag } from '../lib/people'
import type { Me, Org } from '../lib/types'
import { fonts, hud } from '../theme'

/**
 * Small pieces of HUD chrome shared across pages: the ringed avatar, the
 * org tag, status dots and the panel every section sits in.
 */

/** Round avatar with the teal ring; falls back to initials. */
export function HudAvatar({ me, size = 32 }: { me: Me; size?: number }) {
  const name = displayName(me)
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: '#1b2a31',
        boxShadow: `0 0 0 2px ${hud.teal}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: fonts.display,
        fontWeight: 700,
        fontSize: size * 0.38,
        color: hud.teal,
      }}
    >
      {me.avatar_url ? (
        <Box component="img" src={me.avatar_url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials(name)
      )}
    </Box>
  )
}

export function OrgTag({ org, size = 22 }: { org: Pick<Org, 'name' | 'sid'>; size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        minWidth: size,
        height: size,
        px: 0.5,
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(79,209,197,0.14)',
        color: hud.teal,
        fontFamily: fonts.display,
        fontWeight: 700,
        fontSize: size * 0.45,
        letterSpacing: '0.06em',
        flexShrink: 0,
      }}
    >
      {orgTag(org)}
    </Box>
  )
}

export function StatusDot({ colour = hud.teal }: { colour?: string }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colour, boxShadow: `0 0 6px ${colour}`, flexShrink: 0 }}
    />
  )
}

/** Outlined capital-letter badge: ACTIVE, STALE, MANAGER. */
export function HudBadge({ children, colour = hud.teal }: { children: ReactNode; colour?: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        px: 1,
        border: `1px solid ${colour}`,
        color: colour,
        fontFamily: fonts.display,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

interface HudPanelProps {
  /** The section's one heading. */
  title?: ReactNode
  /** Right-hand slot beside the heading: a count, a link, a tab group. */
  aside?: ReactNode
  children: ReactNode
  /** Heading level, so the page outline stays in order. */
  component?: 'h2' | 'h3'
  id?: string
  sx?: SxProps<Theme>
  raised?: boolean
}

/** A panel with a single heading. Never stack a label above that heading. */
export function HudPanel({ title, aside, children, component = 'h2', id, sx, raised }: HudPanelProps) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <Box
      component="section"
      aria-labelledby={title ? headingId : undefined}
      sx={{
        bgcolor: raised ? hud.panelRaised : hud.panel,
        border: `1px solid ${hud.line}`,
        p: 2.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        ...sx,
      }}
    >
      {(title || aside) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          {title && (
            <Typography variant="h6" component={component} id={headingId} sx={{ m: 0 }}>
              {title}
            </Typography>
          )}
          {aside}
        </Box>
      )}
      {children}
    </Box>
  )
}

/** Monospace number, for timestamps, codes and quantities. */
export function Mono({ children, colour }: { children?: ReactNode; colour?: string }) {
  return (
    <Box component="span" sx={{ fontFamily: fonts.mono, color: colour, fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </Box>
  )
}
