import apiClient from '../client'

export const emailPrefsApi = {
  async get(): Promise<{ followUpdates: boolean }> {
    const res = await apiClient.get('/api/email/preferences')
    return res.data
  },
  async setFollowUpdates(followUpdates: boolean): Promise<{ followUpdates: boolean }> {
    const res = await apiClient.patch('/api/email/preferences', { followUpdates })
    return res.data
  },
}
