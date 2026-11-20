import { createTheme } from '@mui/material/styles'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

/**
 * StarBuddy theme — a ship's HUD: near-black ground with a faint grid, teal
 * for what is live or yours, amber for rank and warnings. Square corners.
 *
 * The raw colours live in `hud` so components that draw their own chrome
 * (rank medals, status dots, the grid) use the same values as MUI does.
 */
export const hud = {
  ground: '#0b1014',
  bar: '#0f151a',
  nav: 'rgba(13, 19, 24, 0.85)',
  panel: '#10171c',
  panelRaised: '#131b21',
  well: '#0d1418',
  input: '#121a20',
  line: '#22303a',
  lineSoft: '#1f2b33',
  lineStrong: '#2a3843',
  hover: '#121b21',
  selected: '#121c22',
  text: '#e6edf2',
  textSoft: '#c9d5de',
  textMuted: '#a9b8c3',
  textDim: '#8fa3b1',
  textFaint: '#7d909d',
  teal: '#4fd1c5',
  tealHover: '#8ae6dd',
  tealWash: 'rgba(79, 209, 197, 0.12)',
  amber: '#f0a742',
  gold: '#f0b544',
  silver: '#c6d0d8',
  bronze: '#e09a63',
  danger: '#f2766b',
} as const

export const fonts = {
  display: '"Rajdhani", "Inter", system-ui, sans-serif',
  body: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const

/** The 48px HUD grid drawn behind the whole app. */
export const gridBackground = {
  backgroundColor: hud.ground,
  backgroundImage: `linear-gradient(rgba(79,209,197,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(79,209,197,0.035) 1px, transparent 1px)`,
  backgroundSize: '48px 48px',
} as const

const display = { fontFamily: fonts.display, fontWeight: 700 }

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: hud.ground, paper: hud.panel },
    primary: { main: hud.teal, light: hud.tealHover, contrastText: '#0b1014' },
    secondary: { main: hud.amber, contrastText: '#1d1406' },
    warning: { main: hud.amber },
    error: { main: hud.danger },
    divider: hud.lineSoft,
    text: { primary: hud.text, secondary: hud.textDim },
    action: { hover: hud.hover, selected: hud.selected },
  },
  shape: { borderRadius: 0 },
  typography: {
    fontFamily: fonts.body,
    fontSize: 14,
    h1: { ...display, fontSize: '2.625rem', lineHeight: 1.1, letterSpacing: '0.01em' },
    h2: { ...display, fontSize: '2rem', lineHeight: 1.15, letterSpacing: '0.01em' },
    h3: { ...display, fontSize: '1.625rem', letterSpacing: '0.02em' },
    h4: { ...display, fontSize: '1.5rem', letterSpacing: '0.02em' },
    h5: { ...display, fontSize: '1.25rem', letterSpacing: '0.02em' },
    // Section headings inside panels: small, spaced capitals.
    h6: { ...display, fontSize: '0.95rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: hud.textMuted },
    overline: { fontFamily: fonts.display, fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.2em', lineHeight: 1.6 },
    button: { fontFamily: fonts.display, fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.1em', textTransform: 'uppercase' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: gridBackground,
        ':focus-visible': { outline: `2px solid ${hud.teal}`, outlineOffset: 2 },
        a: { color: hud.teal },
        'a:hover': { color: hud.tealHover },
      },
    },
    MuiToggleButtonGroup: { defaultProps: { color: 'primary' } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          variants: [
            {
              props: { variant: 'outlined', color: 'inherit' },
              style: { borderColor: hud.lineStrong, color: hud.text, '&:hover': { borderColor: '#3d5260', backgroundColor: 'transparent' } },
            },
            {
              props: { variant: 'outlined', color: 'primary' },
              style: { borderColor: hud.teal, color: hud.teal, backgroundColor: hud.tealWash, '&:hover': { borderColor: hud.tealHover, backgroundColor: 'rgba(79,209,197,0.18)' } },
            },
          ],
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 0 } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none', border: `1px solid ${hud.line}`, backgroundColor: hud.panel },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { border: `1px solid ${hud.lineStrong}`, borderTop: `3px solid ${hud.teal}`, boxShadow: '0 24px 60px rgba(0,0,0,0.6)' },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { ...display, fontSize: '1.5rem', letterSpacing: '0.02em' } } },
    MuiMenu: {
      styleOverrides: {
        paper: { border: `1px solid ${hud.lineStrong}`, borderTop: `2px solid ${hud.teal}`, boxShadow: '0 18px 40px rgba(0,0,0,0.55)' },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: hud.bar, backgroundImage: 'none', borderBottom: `1px solid ${hud.line}`, boxShadow: 'none' },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { backgroundColor: hud.bar, borderRight: `1px solid ${hud.lineSoft}` } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: hud.well,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: hud.lineStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#3d5260' },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 0, fontFamily: fonts.display, fontWeight: 700, letterSpacing: '0.08em' } } },
    MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 0, backgroundColor: hud.panelRaised, border: `1px solid ${hud.lineStrong}`, color: hud.text } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: hud.lineSoft },
        head: {
          color: hud.textDim,
          fontFamily: fonts.display,
          fontWeight: 600,
          textTransform: 'uppercase',
          fontSize: '0.78rem',
          letterSpacing: '0.14em',
        },
      },
    },
  },
})
