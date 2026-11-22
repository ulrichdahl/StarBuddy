import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { fonts, hud } from '../theme'
import { isTopic, type HelpDoc } from './content'

interface HelpArticleProps {
  doc: HelpDoc
  /** Opens another topic: a link written as `[Materials](materials)`. */
  onTopic: (id: string) => void
  /** The page that shows a topic on its own, for a link opened in a new tab. */
  topicHref: (id: string) => string
  /** Smaller type, for the side panel. */
  dense?: boolean
}

/** Screenshots are written as `screens/x.png` and live per language under /help/screens/<lang>/. */
const imageSrc = (src: string, lang: string) => (/^(\/|https?:)/.test(src) ? src : `/help/${src.replace(/^screens\//, `screens/${lang}/`)}`)

/**
 * One help topic, rendered from Markdown. Links to another topic stay in the
 * help; links out open in a new tab. Inline code is how keys and on-screen
 * labels are written (`F8`, `Pair`), and is shown as a key cap.
 */
export function HelpArticle({ doc, onTopic, topicHref, dense = false }: HelpArticleProps) {
  return (
    <Box
      sx={{
        color: hud.textSoft,
        fontSize: dense ? 14 : 15.5,
        lineHeight: 1.65,
        '& h2': { fontFamily: fonts.display, fontWeight: 700, fontSize: dense ? 18 : 21, letterSpacing: '0.04em', color: hud.text, mt: 3.5, mb: 1 },
        '& h3': { fontFamily: fonts.display, fontWeight: 700, fontSize: dense ? 16 : 17, color: hud.text, mt: 2.5, mb: 0.75 },
        '& p': { mt: 0, mb: 1.5 },
        '& ul, & ol': { mt: 0, mb: 1.5, pl: 3 },
        '& li': { mb: 0.5 },
        '& li > p': { mb: 0.5 },
        '& strong': { color: hud.text },
        '& code': {
          fontFamily: fonts.mono,
          fontSize: '0.86em',
          px: 0.6,
          py: 0.1,
          border: `1px solid ${hud.lineStrong}`,
          borderBottomWidth: 2,
          borderRadius: 0.5,
          bgcolor: hud.input,
          color: hud.text,
          whiteSpace: 'nowrap',
        },
        '& blockquote': { m: 0, mb: 1.5, px: 2, py: 1, borderLeft: `3px solid ${hud.amber}`, bgcolor: 'rgba(240,167,66,0.06)', '& p:last-child': { mb: 0 } },
        '& table': { borderCollapse: 'collapse', mb: 2, width: '100%', display: 'block', overflowX: 'auto' },
        '& th, & td': { textAlign: 'left', verticalAlign: 'top', px: 1.25, py: 0.75, borderBottom: `1px solid ${hud.lineSoft}` },
        '& th': { color: hud.textMuted, fontWeight: 600, fontSize: '0.9em' },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = '', children }: { href?: string; children?: ReactNode }) => {
            const [id, hash] = href.split('#')
            if (isTopic(id)) {
              return (
                <Link
                  href={topicHref(id) + (hash ? `#${hash}` : '')}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    onTopic(id)
                  }}
                >
                  {children}
                </Link>
              )
            }
            return (
              <Link href={href} target="_blank" rel="noopener">
                {children}
              </Link>
            )
          },
          img: ({ src = '', alt = '' }: { src?: string | Blob; alt?: string }) => {
            const url = typeof src === 'string' ? imageSrc(src, doc.lang) : ''
            return (
              <Box component="a" href={url} target="_blank" rel="noopener" sx={{ display: 'block', my: 2, textDecoration: 'none' }}>
                <Box
                  component="img"
                  src={url}
                  alt={alt}
                  loading="lazy"
                  sx={{ display: 'block', maxWidth: '100%', height: 'auto', border: `1px solid ${hud.lineStrong}`, borderRadius: 1, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}
                />
                {alt && (
                  <Typography component="span" variant="caption" sx={{ display: 'block', mt: 0.75, color: hud.textDim }}>
                    {alt}
                  </Typography>
                )}
              </Box>
            )
          },
        }}
      >
        {doc.body}
      </ReactMarkdown>
    </Box>
  )
}
