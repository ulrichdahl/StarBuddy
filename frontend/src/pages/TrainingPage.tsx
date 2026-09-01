import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ColorizeIcon from '@mui/icons-material/Colorize'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { apiErrorDetail } from '../lib/api'
import { sampleToColour } from '../lib/hudColour'
import { PageHeader } from '../components/PageHeader'
import { PanelCornerPicker, type Point } from '../components/PanelCornerPicker'
import {
  useCorrectSubmission,
  useMySubmissions,
  useReviewQueue,
  useReviewSubmission,
  useSubmitScreenshot,
  useTrainingLabels,
  OversizeError,
  type ScreenshotSubmission,
  type SubmissionStatus,
  type VocabularyEntry,
  type Coverage,
} from '../lib/training'

/**
 * Contribute training screenshots, and (for managers) review the queue.
 *
 * The whole job for one capture happens here: pick the file, mark the panel's
 * four corners, name the screen, submit. Managers get a second tab where each
 * submission arrives with its corners drawn on it, to approve, fix or reject —
 * and a download of everything approved, in the shape the training scripts read.
 */
export function TrainingPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState(0)
  const labels = useTrainingLabels()
  const mine = useMySubmissions()
  const canReview = mine.data?.can_review ?? false

  return (
    <Box>
      <PageHeader title={t('training.title')} subtitle={t('training.subtitle')} />

      <Tabs
        value={tab}
        onChange={(_, value: number) => setTab(value)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={t('training.tabs.contribute')} />
        <Tab label={t('training.tabs.mine', { count: mine.data?.meta.total ?? 0 })} />
        {canReview && <Tab label={t('training.tabs.review')} />}
      </Tabs>

      {tab === 0 && <ContributeTab labels={labels.data} loading={labels.isLoading} />}
      {tab === 1 && <MySubmissionsTab />}
      {tab === 2 && canReview && <ReviewTab />}
    </Box>
  )
}

/* ------------------------------------------------------------------ contribute */

function ContributeTab({
  labels,
  loading,
}: {
  labels: ReturnType<typeof useTrainingLabels>['data']
  loading: boolean
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [corners, setCorners] = useState<Point[]>([])
  const [screen, setScreen] = useState('')
  const [hudColour, setHudColour] = useState('')
  const [hudHex, setHudHex] = useState<string | null>(null)
  const [sampling, setSampling] = useState(false)
  const [ship, setShip] = useState('')
  const [occluded, setOccluded] = useState(false)
  const [note, setNote] = useState('')
  const submit = useSubmitScreenshot()

  // Derive the object URL from the file rather than storing it, and release
  // it when the file changes — the browser keeps it alive until revoked.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const reset = () => {
    setFile(null)
    setCorners([])
    setShip('')
    setHudHex(null)
    setSampling(false)
    setOccluded(false)
    setNote('')
    submit.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const chooseFile = (chosen: File | undefined) => {
    if (!chosen) return
    submit.reset()
    setCorners([])
    setFile(chosen)
  }

  const tooBig = file !== null && labels !== undefined && file.size > labels.max_bytes
  const ready = file !== null && corners.length === 4 && screen !== '' && hudColour !== '' && !tooBig

  const handleSubmit = () => {
    if (!ready || !file || !labels) return
    submit.mutate(
      {
        image: file,
        screen,
        hud_colour: hudColour,
        hud_hex: hudHex,
        patch: labels.patch,
        ship,
        occluded,
        submitter_note: note,
        quad: corners,
      },
      { onSuccess: reset },
    )
  }

  if (loading) {
    return <CircularProgress aria-label={t('common.loading')} />
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 1100 }}>
      <Alert severity="info" icon={false}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {t('training.help.title')}
        </Typography>
        <Typography variant="body2" component="div">
          {t('training.help.body')}
        </Typography>
      </Alert>

      {submit.isSuccess && <Alert severity="success">{t('training.submitted')}</Alert>}
      {submit.isError && (
        <Alert severity="error">
          {submit.error instanceof OversizeError
            ? t('training.tooBig', { limit: Math.round((labels?.max_bytes ?? 0) / (1024 * 1024)) })
            : (apiErrorDetail(submit.error) ?? t('training.submitFailed'))}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <Button
            variant="contained"
            startIcon={<AddPhotoAlternateIcon />}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('training.chooseScreenshot')}
          </Button>
          {file && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, wordBreak: 'break-all' }}>
                {file.name}
              </Typography>
              <Button size="small" startIcon={<RestartAltIcon />} onClick={reset}>
                {t('common.clear')}
              </Button>
            </>
          )}
        </Stack>
        {tooBig && labels && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t('training.tooBig', { limit: Math.round(labels.max_bytes / (1024 * 1024)) })}
          </Alert>
        )}
      </Paper>

      {preview && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1.6fr 1fr' } }}>
          <Box>
            <PanelCornerPicker
              src={preview}
              corners={corners}
              onChange={setCorners}
              mode={sampling ? 'eyedropper' : 'corners'}
              onSample={({ r, g, b }) => {
                const sampled = sampleToColour(r, g, b)
                setHudHex(sampled.hex)
                setHudColour(sampled.bucket)
                setSampling(false)
              }}
            />
            {corners.length > 0 && !sampling && (
              <Button size="small" sx={{ mt: 1 }} onClick={() => setCorners([])}>
                {t('training.picker.startOver')}
              </Button>
            )}
          </Box>

          <Stack spacing={2}>
            <NameAutocomplete
              label={t('training.fields.screen')}
              helperText={t('training.fields.screenHelp')}
              options={labels?.screens ?? []}
              value={screen}
              onChange={setScreen}
              required
              translateKnown="training.screens"
            />

            <HudColourField
              colours={labels?.hud_colours ?? []}
              value={hudColour}
              hex={hudHex}
              sampling={sampling}
              onSampleToggle={() => setSampling((on) => !on)}
              onChange={(value) => {
                setHudColour(value)
                // A hand-picked name and a sampled hex would contradict each
                // other, so overriding the name drops the measurement.
                setHudHex(null)
              }}
            />

            <NameAutocomplete
              label={t('training.fields.ship')}
              helperText={t('training.fields.shipHelp')}
              options={labels?.ships ?? []}
              value={ship}
              onChange={setShip}
            />

            <FormControlLabel
              control={<Switch checked={occluded} onChange={(event) => setOccluded(event.target.checked)} />}
              label={t('training.fields.occluded')}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
              {t('training.fields.occludedHelp')}
            </Typography>

            <TextField
              label={t('training.fields.note')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              multiline
              minRows={2}
            />

            <Typography variant="caption" color="text.secondary">
              {t('training.fields.patchNote', { patch: labels?.patch ?? '' })}
            </Typography>

            <Button
              variant="contained"
              size="large"
              disabled={!ready || submit.isPending}
              onClick={handleSubmit}
            >
              {submit.isPending ? t('training.submitting') : t('training.submit')}
            </Button>
            {!ready && (
              <Typography variant="caption" color="text.secondary">
                {t('training.submitBlocked')}
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}

/* ------------------------------------------------------------------- fields */

/**
 * A name from an open vocabulary: pick one others have used, or type a new one.
 *
 * Free text is what lets a contributor submit a panel nobody has named yet,
 * but it is also how a vocabulary fragments, so the existing names are offered
 * first with their usage counts and the server folds whatever is typed to
 * lowercase-with-underscores.
 */
function NameAutocomplete({
  label,
  helperText,
  options,
  value,
  onChange,
  required = false,
  translateKnown,
}: {
  label: string
  helperText: string
  options: VocabularyEntry[]
  value: string
  onChange: (value: string) => void
  required?: boolean
  /** Translation namespace for names we ship labels for, e.g. training.screens. */
  translateKnown?: string
}) {
  const { t } = useTranslation()

  const display = (name: string) =>
    translateKnown ? t(`${translateKnown}.${name}`, name) : name

  return (
    <Autocomplete
      freeSolo
      autoHighlight
      options={options.map((entry) => entry.name)}
      value={value}
      onChange={(_, next) => onChange(next ?? '')}
      onInputChange={(_, next) => onChange(next)}
      getOptionLabel={(option) => option}
      renderOption={(props, option) => {
        const entry = options.find((candidate) => candidate.name === option)
        // A plain <li>, not MenuItem: Autocomplete's listbox is a bare <ul>, and
        // MenuItem throws without a Menu/MenuList context around it.
        return (
          <Box
            component="li"
            {...props}
            key={option}
            sx={{ display: 'flex', width: '100%', gap: 1, alignItems: 'baseline' }}
          >
            <Box sx={{ flexGrow: 1 }}>{display(option)}</Box>
            <Typography variant="caption" color="text.secondary">
              {entry && entry.count > 0 ? entry.count : t('training.fields.notUsedYet')}
            </Typography>
          </Box>
        )
      }}
      renderInput={(params) => (
        <TextField {...params} label={label} required={required} helperText={helperText} />
      )}
    />
  )
}

/**
 * HUD colour, sampled off the panel rather than guessed from a list.
 *
 * Judging "is this amber or white" by eye is a decision contributors get wrong
 * and shouldn't have to make: they click the brightest bit of the HUD, the app
 * derives the bucket, and the hex is submitted alongside as the real record.
 * The list stays as an override for a panel the sampler misreads.
 */
function HudColourField({
  colours,
  value,
  hex,
  sampling,
  onSampleToggle,
  onChange,
}: {
  colours: string[]
  value: string
  hex: string | null
  sampling: boolean
  onSampleToggle: () => void
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          variant={sampling ? 'contained' : 'outlined'}
          startIcon={<ColorizeIcon />}
          onClick={onSampleToggle}
          fullWidth
        >
          {sampling ? t('training.fields.samplingActive') : t('training.fields.sampleColour')}
        </Button>
        {hex && (
          <Box
            aria-label={t('training.fields.sampledSwatch', { hex })}
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              bgcolor: hex,
            }}
          />
        )}
      </Stack>

      <TextField
        select
        required
        size="small"
        label={t('training.fields.hudColour')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        helperText={hex ? t('training.fields.sampledHelp', { hex }) : t('training.fields.hudColourHelp')}
      >
        {colours.map((colour) => (
          <MenuItem key={colour} value={colour}>
            {t(`training.hudColours.${colour}`, colour)}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
}

/* ----------------------------------------------------------------------- mine */

function MySubmissionsTab() {
  const { t } = useTranslation()
  const mine = useMySubmissions()

  if (mine.isLoading) return <CircularProgress aria-label={t('common.loading')} />
  if (!mine.data || mine.data.data.length === 0) {
    return <Alert severity="info">{t('training.noneYet')}</Alert>
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        {(['pending', 'approved', 'rejected'] as SubmissionStatus[]).map((status) => (
          <Chip
            key={status}
            size="small"
            label={`${t(`training.status.${status}`)}: ${mine.data.counts[status] ?? 0}`}
            color={status === 'approved' ? 'success' : status === 'rejected' ? 'default' : 'warning'}
            variant={status === 'rejected' ? 'outlined' : 'filled'}
          />
        ))}
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
        {mine.data.data.map((submission) => (
          <SubmissionCard key={submission.id} submission={submission} />
        ))}
      </Box>
    </Stack>
  )
}

function SubmissionCard({ submission }: { submission: ScreenshotSubmission }) {
  const { t } = useTranslation()

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <QuadThumbnail submission={submission} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
        <Chip
          size="small"
          label={t(`training.status.${submission.status}`)}
          color={
            submission.status === 'approved' ? 'success' : submission.status === 'rejected' ? 'error' : 'warning'
          }
        />
        <Typography variant="body2">{t(`training.screens.${submission.screen}`, submission.screen)}</Typography>
      </Stack>
      {submission.review_note && (
        <Typography variant="caption" color="text.secondary">
          {t('training.reviewNote')}: {submission.review_note}
        </Typography>
      )}
    </Paper>
  )
}

/** The capture with its stored quad drawn over it — no interaction. */
function QuadThumbnail({ submission }: { submission: ScreenshotSubmission }) {
  const points = submission.quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')

  return (
    <Box sx={{ position: 'relative', lineHeight: 0, borderRadius: 1, overflow: 'hidden' }}>
      <Box component="img" src={submission.image_url} alt="" sx={{ display: 'block', width: '100%' }} />
      <Box
        component="svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <polygon
          points={points}
          fill="rgba(79, 201, 190, 0.12)"
          stroke="#4fc9be"
          strokeWidth="0.3"
          vectorEffect="non-scaling-stroke"
        />
      </Box>
    </Box>
  )
}

/* --------------------------------------------------------------------- review */

function ReviewTab() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<SubmissionStatus>('pending')
  const queue = useReviewQueue(status, true)
  const review = useReviewSubmission()
  const correct = useCorrectSubmission()
  const [editing, setEditing] = useState<number | null>(null)
  const [draftCorners, setDraftCorners] = useState<Point[]>([])
  const [draftScreen, setDraftScreen] = useState('')

  const counts = queue.data?.counts ?? {}
  const approvedCount = counts.approved ?? 0

  const startEditing = (submission: ScreenshotSubmission) => {
    setEditing(submission.id)
    setDraftCorners(submission.quad)
    setDraftScreen(submission.screen)
  }

  const saveCorrection = (id: number) => {
    correct.mutate(
      { id, quad: draftCorners, screen: draftScreen },
      { onSuccess: () => setEditing(null) },
    )
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={1}>
          {(['pending', 'approved', 'rejected'] as SubmissionStatus[]).map((value) => (
            <Chip
              key={value}
              label={`${t(`training.status.${value}`)} (${counts[value] ?? 0})`}
              onClick={() => setStatus(value)}
              color={status === value ? 'primary' : 'default'}
              variant={status === value ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          disabled={approvedCount === 0}
          href="/api/training/screenshots/export"
        >
          {t('training.export', { count: approvedCount })}
        </Button>
      </Paper>

      {correct.isError && (
        <Alert severity="error">{apiErrorDetail(correct.error) ?? t('training.correctFailed')}</Alert>
      )}
      {review.isError && (
        <Alert severity="error">{apiErrorDetail(review.error) ?? t('training.reviewFailed')}</Alert>
      )}

      {queue.isLoading && <CircularProgress aria-label={t('common.loading')} />}
      {queue.data && queue.data.data.length === 0 && (
        <Alert severity="info">{t('training.queueEmpty')}</Alert>
      )}

      <Stack spacing={2}>
        {(queue.data?.data ?? []).map((submission) => (
          <Paper key={submission.id} variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr' } }}>
              <Box>
                {editing === submission.id ? (
                  <PanelCornerPicker
                    src={submission.image_url}
                    corners={draftCorners}
                    onChange={setDraftCorners}
                  />
                ) : (
                  <QuadThumbnail submission={submission} />
                )}
              </Box>

              <Stack spacing={1.5}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {t(`training.screens.${submission.screen}`, submission.screen)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('training.submittedBy', { who: submission.submitted_by ?? '—' })}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  <Chip size="small" label={submission.patch} />
                  {submission.ship && <Chip size="small" label={submission.ship} />}
                  <Chip
                    size="small"
                    label={t(`training.hudColours.${submission.hud_colour}`, submission.hud_colour)}
                    icon={
                      submission.hud_hex ? (
                        <Box
                          component="span"
                          aria-label={t('training.sampledColour')}
                          sx={{
                            width: 12,
                            height: 12,
                            ml: 0.75,
                            borderRadius: '2px',
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: submission.hud_hex,
                          }}
                        />
                      ) : undefined
                    }
                  />
                  <Chip size="small" label={`${submission.width}×${submission.height}`} />
                  {submission.occluded && (
                    <Chip size="small" color="warning" label={t('training.occludedChip')} />
                  )}
                </Stack>
                {submission.submitter_note && (
                  <Typography variant="body2" color="text.secondary">
                    “{submission.submitter_note}”
                  </Typography>
                )}

                {editing === submission.id ? (
                  <Stack spacing={1.5}>
                    <TextField
                      size="small"
                      label={t('training.editScreen')}
                      value={draftScreen}
                      onChange={(event) => setDraftScreen(event.target.value)}
                      helperText={t('training.editScreenHelp')}
                    />
                    <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={draftCorners.length !== 4 || draftScreen.trim() === '' || correct.isPending}
                      onClick={() => saveCorrection(submission.id)}
                    >
                      {t('training.saveCorners')}
                    </Button>
                    <Button size="small" onClick={() => setEditing(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="small" onClick={() => setDraftCorners([])}>
                      {t('training.picker.startOver')}
                    </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {submission.status === 'pending' && (
                      <>
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          startIcon={<CheckIcon />}
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: submission.id, status: 'approved' })}
                        >
                          {t('training.approve')}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          startIcon={<CloseIcon />}
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: submission.id, status: 'rejected' })}
                        >
                          {t('training.reject')}
                        </Button>
                      </>
                    )}
                    <Button size="small" onClick={() => startEditing(submission)}>
                      {t('training.correct')}
                    </Button>
                  </Stack>
                )}

                {submission.exported_at && (
                  <Typography variant="caption" color="text.secondary">
                    {t('training.alreadyExported')}
                  </Typography>
                )}
              </Stack>
            </Box>
          </Paper>
        ))}
      </Stack>

      {queue.data?.coverage && <CoverageBreakdown coverage={queue.data.coverage} />}
    </Stack>
  )
}

/**
 * Approved captures per screen, emptiest first.
 *
 * The total alone hides the thing that actually blocks training: the corner
 * detector improves from every capture whatever the screen, but each screen
 * needs its own volume before the classifier can tell it apart from the others.
 * A collection of 400 spread thinly over ten screens trains worse than 200
 * across four.
 */
function CoverageBreakdown({ coverage }: { coverage: Coverage }) {
  const { t } = useTranslation()
  const approved = coverage.screens.reduce((sum, row) => sum + row.approved, 0)
  const started = coverage.screens.filter((row) => row.approved > 0 || row.pending > 0)
  const short = started.filter((row) => row.approved < coverage.target)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t('training.coverage.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('training.coverage.subtitle', { approved, target: coverage.target, short: short.length })}
      </Typography>

      <Stack spacing={1.25}>
        {coverage.screens.map((row) => {
          const ratio = Math.min(1, row.approved / coverage.target)
          const enough = row.approved >= coverage.target
          return (
            <Box key={row.screen} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="body2" sx={{ flexBasis: '40%', minWidth: 0 }}>
                {t(`training.screens.${row.screen}`, row.screen)}
              </Typography>

              <Box
                sx={{
                  flexGrow: 1,
                  height: 8,
                  borderRadius: 4,
                  bgcolor: 'action.hover',
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    width: `${ratio * 100}%`,
                    height: '100%',
                    bgcolor: enough ? 'success.main' : row.approved === 0 ? 'error.main' : 'warning.main',
                  }}
                />
              </Box>

              <Typography
                variant="body2"
                sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}
                color={enough ? 'success.main' : 'text.secondary'}
              >
                {row.approved} / {coverage.target}
              </Typography>

              {row.pending > 0 && (
                <Chip size="small" variant="outlined" label={t('training.coverage.waiting', { count: row.pending })} />
              )}
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}
