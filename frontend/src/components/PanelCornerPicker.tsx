import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'

/** One corner, normalised 0..1 against the image's own width and height. */
export type Point = [number, number]

interface PanelCornerPickerProps {
  /** Object URL or API URL of the screenshot being marked. */
  src: string
  corners: Point[]
  onChange: (corners: Point[]) => void
  /** Read-only display, e.g. a reviewer glancing at a decided submission. */
  disabled?: boolean
  /**
   * 'corners' places and drags the quad; 'eyedropper' samples the pixel under
   * the pointer instead, for reading the HUD colour off the panel.
   */
  mode?: 'corners' | 'eyedropper'
  /** Called with the sampled colour: the brightest pixel in a small patch. */
  onSample?: (rgb: { r: number; g: number; b: number }) => void
}

const HANDLE_LABELS = ['1', '2', '3', '4']
/** How far one arrow-key nudge moves a corner, as a fraction of the image. */
const NUDGE = 0.002
const MAGNIFIER_SIZE = 132
const MAGNIFIER_ZOOM = 5
/**
 * Sampling reads a small square rather than one pixel: HUD text is thin and
 * anti-aliased, so a single pixel is as likely to land on the dark gap between
 * two strokes as on the stroke itself.
 */
const SAMPLE_RADIUS = 2

/**
 * Click the four corners of the game panel, then drag to fine-tune.
 *
 * Corners are stored in click order and normalised against the image, so the
 * same marks survive any display size; the server reorders them to top-left
 * first. A magnifier follows the pointer because the corner of a lit screen is
 * a two-pixel decision at these resolutions, and the panel is usually the
 * dimmest thing in the frame.
 */
export function PanelCornerPicker({
  src,
  corners,
  onChange,
  disabled = false,
  mode = 'corners',
  onSample,
}: PanelCornerPickerProps) {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLDivElement>(null)
  // Holds the image at its natural size so pixels can be read back. The source
  // is same-origin (an object URL, or our own API), so the canvas is untainted.
  const pixelsRef = useRef<HTMLCanvasElement | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }): Point | null => {
    const frame = frameRef.current
    if (!frame) return null
    const box = frame.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
  }, [])

  const sampleAt = (point: Point) => {
    const canvas = pixelsRef.current
    if (!canvas || !onSample) return
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    const x = Math.round(point[0] * canvas.width)
    const y = Math.round(point[1] * canvas.height)
    const left = Math.max(0, x - SAMPLE_RADIUS)
    const top = Math.max(0, y - SAMPLE_RADIUS)
    const width = Math.min(canvas.width - left, SAMPLE_RADIUS * 2 + 1)
    const height = Math.min(canvas.height - top, SAMPLE_RADIUS * 2 + 1)
    if (width <= 0 || height <= 0) return

    const { data } = context.getImageData(left, top, width, height)
    let r = 0
    let g = 0
    let b = 0
    let brightest = -1
    // Take the brightest pixel in the patch, not the mean: the contributor is
    // aiming at a lit glyph or border, and averaging in its dark background
    // drags every sample toward grey.
    for (let i = 0; i < data.length; i += 4) {
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (luma > brightest) {
        brightest = luma
        r = data[i]
        g = data[i + 1]
        b = data[i + 2]
      }
    }

    onSample({ r, g, b })
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (disabled) return
    const point = pointFromEvent(event)
    if (!point) return

    if (mode === 'eyedropper') {
      sampleAt(point)
      return
    }

    if (corners.length < 4) {
      onChange([...corners, point])
    }
  }

  const moveCorner = (index: number, point: Point) => {
    const next = corners.slice()
    // Corners are deliberately not clamped to the frame: a panel can run off
    // the edge of the capture, and the model is trained on where the corner
    // really is rather than where the screenshot stops.
    next[index] = point
    onChange(next)
  }

  // Dragging continues outside the image, so the listeners live on the window.
  useEffect(() => {
    if (dragging === null) return

    const onMove = (event: PointerEvent) => {
      const point = pointFromEvent(event)
      if (point) {
        setPointer(point)
        moveCorner(dragging, point)
      }
    }
    const onUp = () => setDragging(null)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, corners, pointFromEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  const onHandleKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    if (disabled) return
    const deltas: Record<string, Point> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    const [x, y] = corners[index]
    const step = event.shiftKey ? 5 : 1
    moveCorner(index, [x + delta[0] * step, y + delta[1] * step])
  }

  const quadPoints = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')
  const complete = corners.length === 4

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        ref={frameRef}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => setPointer(pointFromEvent(event))}
        onPointerLeave={() => setPointer(null)}
        sx={{
          position: 'relative',
          lineHeight: 0,
          borderRadius: 1,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          cursor: disabled ? 'default' : mode === 'eyedropper' ? 'crosshair' : complete ? 'default' : 'crosshair',
          touchAction: 'none',
          userSelect: 'none',
          bgcolor: 'action.hover',
        }}
      >
        <Box
          component="img"
          src={src}
          alt={t('training.picker.imageAlt')}
          draggable={false}
          onLoad={(event: React.SyntheticEvent<HTMLImageElement>) => {
            const image = event.currentTarget
            setNatural({ width: image.naturalWidth, height: image.naturalHeight })

            const canvas = pixelsRef.current ?? document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            canvas.getContext('2d')?.drawImage(image, 0, 0)
            pixelsRef.current = canvas
          }}
          sx={{ display: 'block', width: '100%', height: 'auto' }}
        />

        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {complete && (
            <polygon
              points={quadPoints}
              fill="rgba(79, 201, 190, 0.14)"
              stroke="#4fc9be"
              strokeWidth="0.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {!complete && corners.length > 1 && (
            <polyline
              points={quadPoints}
              fill="none"
              stroke="#4fc9be"
              strokeWidth="0.25"
              strokeDasharray="1 1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </Box>

        {corners.map(([x, y], index) => (
          <Box
            key={index}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={t('training.picker.cornerHandle', { number: index + 1 })}
            onPointerDown={(event: React.PointerEvent) => {
              if (disabled) return
              event.stopPropagation()
              setDragging(index)
            }}
            onKeyDown={onHandleKeyDown(index)}
            sx={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 22,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '50%',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
              color: '#06231f',
              bgcolor: '#4fc9be',
              boxShadow: '0 0 0 2px rgba(0,0,0,0.55)',
              cursor: disabled ? 'default' : 'grab',
              touchAction: 'none',
            }}
          >
            {HANDLE_LABELS[index]}
          </Box>
        ))}

        {/* Magnifier: only while the pointer is over the image and there is
            still something to place or adjust. */}
        {pointer && natural && !disabled && (
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: `calc(${pointer[0] * 100}% + 24px)`,
              top: `calc(${pointer[1] * 100}% + 24px)`,
              width: MAGNIFIER_SIZE,
              height: MAGNIFIER_SIZE,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.7)',
              boxShadow: 3,
              pointerEvents: 'none',
              backgroundImage: `url(${src})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${natural.width * MAGNIFIER_ZOOM}px ${natural.height * MAGNIFIER_ZOOM}px`,
              backgroundPosition: `${-pointer[0] * natural.width * MAGNIFIER_ZOOM + MAGNIFIER_SIZE / 2}px ${
                -pointer[1] * natural.height * MAGNIFIER_ZOOM + MAGNIFIER_SIZE / 2
              }px`,
              // Crosshair through the middle of the loupe.
              '&::before, &::after': {
                content: '""',
                position: 'absolute',
                bgcolor: 'rgba(79, 201, 190, 0.9)',
              },
              '&::before': { left: '50%', top: 0, bottom: 0, width: '1px' },
              '&::after': { top: '50%', left: 0, right: 0, height: '1px' },
            }}
          />
        )}
      </Box>

      <Typography variant="caption" color="text.secondary">
        {mode === 'eyedropper'
          ? t('training.picker.sampleHint')
          : complete
            ? t('training.picker.adjustHint')
            : t('training.picker.clickHint', { remaining: 4 - corners.length })}
      </Typography>
    </Box>
  )
}
