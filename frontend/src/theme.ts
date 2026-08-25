import { createTheme } from '@mui/material/styles'

/**
 * StarBuddy theme — industrial sci-fi, dark by default.
 * Deep space blue-black ground, cyan primary, amber secondary.
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#0C1117',
      paper: '#121A23',
    },
    primary: {
      main: '#5BC8DB',
      contrastText: '#06222A',
    },
    secondary: {
      main: '#E8B45A',
      contrastText: '#2A1E06',
    },
    divider: 'rgba(91, 200, 219, 0.12)',
    text: {
      primary: '#DCE6EE',
      secondary: '#8CA0B3',
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '0.02em' },
    h5: { fontWeight: 700, letterSpacing: '0.02em' },
    h6: { fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.95rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(91, 200, 219, 0.10)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#0C1117',
          backgroundImage: 'none',
          borderBottom: '1px solid rgba(91, 200, 219, 0.12)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0C1117',
          borderRight: '1px solid rgba(91, 200, 219, 0.12)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: '#8CA0B3',
          fontWeight: 600,
          textTransform: 'uppercase',
          fontSize: '0.72rem',
          letterSpacing: '0.08em',
        },
      },
    },
  },
})
