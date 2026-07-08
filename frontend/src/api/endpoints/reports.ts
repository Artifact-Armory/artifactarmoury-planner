import apiClient from '../client'

const BASE_URL = '/api/reports'

export type ReportReason =
  | 'copyright' | 'offensive' | 'not_as_advertised'
  | 'no_printed_photo' | 'broken_file' | 'other'

export interface ReportReasonOption {
  value: ReportReason
  label: string
  proofRequired: boolean
  hint?: string
}

// Kept in sync with the backend's PROOF_REQUIRED set.
export const REPORT_REASONS: ReportReasonOption[] = [
  { value: 'copyright', label: 'Copyright infringement', proofRequired: true, hint: 'Upload proof you own the work or that it copies an existing design.' },
  { value: 'not_as_advertised', label: 'Not as advertised', proofRequired: true, hint: 'Upload a photo showing how the model differs from its listing.' },
  { value: 'broken_file', label: 'Broken / unprintable file', proofRequired: true, hint: 'Upload a screenshot or photo of the fault.' },
  { value: 'offensive', label: 'Offensive / inappropriate', proofRequired: false },
  { value: 'no_printed_photo', label: 'No photo of a printed model', proofRequired: false },
  { value: 'other', label: 'Other', proofRequired: false },
]

export interface ReportAttachmentInput {
  key: string
  filename?: string
  contentType?: string
}

export interface MyReport {
  id: string
  reason: ReportReason
  status: string
  created_at: string
  resolved_at?: string | null
  resolution_action?: string | null
  resolution_summary?: string | null
  model_id?: string | null
  model_name?: string | null
  thumbnail_path?: string | null
}

function putToR2(uploadUrl: string, file: File, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.send(file)
  })
}

export const reportsApi = {
  /** Presign + upload a proof file to R2, returning the attachment descriptor. */
  async uploadProof(file: File): Promise<ReportAttachmentInput> {
    const res = await apiClient.post(`${BASE_URL}/presign-proof`, { filename: file.name })
    const { uploadUrl, key, contentType } = res.data
    await putToR2(uploadUrl, file, contentType)
    return { key, filename: file.name, contentType }
  },

  async submit(input: { modelId: string; reason: ReportReason; detail?: string; attachments?: ReportAttachmentInput[] }): Promise<{ reportId: string }> {
    const res = await apiClient.post(BASE_URL, input)
    return { reportId: res.data?.reportId }
  },

  /** Reports filed against the signed-in artist's models. */
  async getAgainstMe(): Promise<MyReport[]> {
    const res = await apiClient.get(`${BASE_URL}/against-me`)
    return res.data?.reports ?? []
  },
}
