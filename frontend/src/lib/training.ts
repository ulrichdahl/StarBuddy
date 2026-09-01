import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { api } from './api'
import type { Point } from '../components/PanelCornerPicker'

export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

/** One name in an open vocabulary, with how often it has been used. */
export interface VocabularyEntry {
  name: string
  count: number
}

/** The label vocabulary the model is trained against, from the server. */
export interface TrainingLabelOptions {
  /** Known screens, most-used first. Contributors may add new ones. */
  screens: VocabularyEntry[]
  /** Ships already named by someone. Also open. */
  ships: VocabularyEntry[]
  hud_colours: string[]
  corners: string[]
  /** Current game patch, prefilled on the form so members never type it. */
  patch: string
  max_bytes: number
}

export interface ScreenshotSubmission {
  id: number
  status: SubmissionStatus
  screen: string
  hud_colour: string
  /** The colour the contributor sampled off the panel, when they sampled one. */
  hud_hex: string | null
  patch: string
  ship: string | null
  occluded: boolean
  quad: Point[]
  width: number
  height: number
  image_url: string
  submitter_note: string | null
  review_note: string | null
  created_at: string | null
  reviewed_at: string | null
  exported_at: string | null
  /** Only present in the review queue. */
  submitted_by?: string
}

/** Approved captures per screen, against the per-class target. */
export interface Coverage {
  target: number
  screens: { screen: string; approved: number; pending: number }[]
}

interface SubmissionList {
  data: ScreenshotSubmission[]
  meta: { total: number; per_page: number; current_page: number; last_page: number }
  counts: Partial<Record<SubmissionStatus, number>>
  can_review?: boolean
  /** Review queue only. */
  coverage?: Coverage
}

/** Thrown when the server refused the upload for its size alone. */
export class OversizeError extends Error {
  constructor() {
    super('oversize')
    this.name = 'OversizeError'
  }
}

export interface NewSubmission {
  image: File
  screen: string
  hud_colour: string
  hud_hex: string | null
  patch: string
  ship: string
  occluded: boolean
  submitter_note: string
  quad: Point[]
}

export function useTrainingLabels() {
  return useQuery({
    queryKey: ['training', 'labels'],
    queryFn: async () => (await api.get<TrainingLabelOptions>('/api/training/labels')).data,
    staleTime: 60 * 60 * 1000,
  })
}

/** The caller's own submissions, and whether they may review others'. */
export function useMySubmissions() {
  return useQuery({
    queryKey: ['training', 'mine'],
    queryFn: async () => (await api.get<SubmissionList>('/api/training/screenshots')).data,
  })
}

export function useReviewQueue(status: SubmissionStatus, enabled: boolean) {
  return useQuery({
    queryKey: ['training', 'queue', status],
    queryFn: async () =>
      (await api.get<SubmissionList>('/api/training/screenshots/queue', { params: { status } })).data,
    enabled,
  })
}

export function useSubmitScreenshot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (submission: NewSubmission) => {
      const form = new FormData()
      form.append('image', submission.image)
      form.append('screen', submission.screen)
      form.append('hud_colour', submission.hud_colour)
      if (submission.hud_hex) form.append('hud_hex', submission.hud_hex)
      form.append('patch', submission.patch)
      form.append('occluded', submission.occluded ? '1' : '0')
      if (submission.ship.trim()) form.append('ship', submission.ship.trim())
      if (submission.submitter_note.trim()) form.append('submitter_note', submission.submitter_note.trim())
      // Laravel reads bracketed keys back into the nested array the validator wants.
      submission.quad.forEach(([x, y], index) => {
        form.append(`quad[${index}][0]`, String(x))
        form.append(`quad[${index}][1]`, String(y))
      })

      try {
        const { data } = await api.post<ScreenshotSubmission>('/api/training/screenshots', form)
        return data
      } catch (error) {
        // A capture over the server's post limit never reaches the validator:
        // PHP discards the body, so Laravel answers 413 with no JSON, or 422
        // complaining the image is missing. Neither says anything about size,
        // which is the one thing the contributor needs to hear.
        if (isAxiosError(error) && error.response?.status === 413) {
          throw new OversizeError()
        }
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['training'] })
    },
  })
}

export function useReviewSubmission() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: number; status: 'approved' | 'rejected'; review_note?: string }) => {
      const { data } = await api.post<ScreenshotSubmission>(
        `/api/training/screenshots/${input.id}/review`,
        { status: input.status, review_note: input.review_note ?? null },
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['training'] })
    },
  })
}

/** A manager fixing the corners or the labels before approving. */
export function useCorrectSubmission() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: number
      quad?: Point[]
      screen?: string
      ship?: string | null
      hud_colour?: string
    }) => {
      const { id, ...changes } = input
      const { data } = await api.patch<ScreenshotSubmission>(`/api/training/screenshots/${id}`, changes)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['training'] })
    },
  })
}
