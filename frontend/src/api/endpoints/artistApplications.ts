import apiClient from '../client'

const BASE_URL = '/api/artist-applications'
const ADMIN_URL = '/api/admin/artist-applications'

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface ApplicationImageInput {
  key: string
  filename?: string
  contentType?: string
}

export interface MyApplication {
  id: string
  status: ApplicationStatus
  artistName: string
  decisionReason: string | null
  createdAt: string
  reviewedAt: string | null
  /** Present only while an approved code can still be redeemed. */
  inviteCode: string | null
}

export interface SubmitApplicationInput {
  artistName: string
  about: string
  whatYouMake: string
  websiteUrl?: string
  socialLinks: string[]
  sellsElsewhere?: string
  images: ApplicationImageInput[]
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

export const artistApplicationsApi = {
  async uploadImage(file: File): Promise<ApplicationImageInput> {
    const res = await apiClient.post(`${BASE_URL}/presign-image`, { filename: file.name })
    const { uploadUrl, key, contentType } = res.data
    await putToR2(uploadUrl, file, contentType)
    return { key, filename: file.name, contentType }
  },

  async mine(): Promise<MyApplication | null> {
    const res = await apiClient.get(`${BASE_URL}/mine`)
    return res.data?.application ?? null
  },

  async submit(input: SubmitApplicationInput): Promise<{ id: string }> {
    const res = await apiClient.post(BASE_URL, input)
    return { id: res.data?.id }
  },
}

// ---- Admin -----------------------------------------------------------------

export interface AdminApplicationTile {
  id: string
  status: ApplicationStatus
  artist_name: string
  applicant_name: string
  applicant_email: string
  created_at: string
  reviewed_at: string | null
  image_count: string | number
}

export interface AdminApplicationDetail {
  id: string
  status: ApplicationStatus
  artist_name: string
  applicant_name: string
  applicant_email: string
  about: string
  what_you_make: string
  website_url: string | null
  social_links: string[]
  sells_elsewhere: string | null
  decision_reason: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  created_at: string
  invite_code: string | null
  user_role: string | null
}

export interface AdminApplicationImage {
  id: string
  file_name: string | null
  url: string
}

export const adminApplicationsApi = {
  async list(status: ApplicationStatus): Promise<{ applications: AdminApplicationTile[]; pendingCount: number }> {
    const res = await apiClient.get(ADMIN_URL, { params: { status } })
    return res.data
  },

  async get(id: string): Promise<{ application: AdminApplicationDetail; images: AdminApplicationImage[] }> {
    const res = await apiClient.get(`${ADMIN_URL}/${id}`)
    return res.data
  },

  async approve(id: string, message?: string): Promise<{ code: string }> {
    const res = await apiClient.post(`${ADMIN_URL}/${id}/approve`, { message })
    return res.data
  },

  async reject(id: string, reason: string): Promise<void> {
    await apiClient.post(`${ADMIN_URL}/${id}/reject`, { reason })
  },
}
