import apiClient from '../client'

const BASE_URL = '/api/contact'

export interface ContactAttachmentInput {
  key: string
  filename?: string
  contentType?: string
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

export const contactApi = {
  /** Presign + upload one attachment to R2, returning the descriptor to submit with the message. */
  async uploadAttachment(file: File): Promise<ContactAttachmentInput> {
    const res = await apiClient.post(`${BASE_URL}/presign-attachment`, { filename: file.name })
    const { uploadUrl, key, contentType } = res.data
    await putToR2(uploadUrl, file, contentType)
    return { key, filename: file.name, contentType }
  },

  async submit(input: {
    name: string
    email: string
    subject: string
    message: string
    attachments?: ContactAttachmentInput[]
  }): Promise<{ id: string }> {
    const res = await apiClient.post(BASE_URL, input)
    return { id: res.data?.id }
  },
}
