import apiClient from '../client'

export type CollabStatus = 'pending' | 'accepted' | 'declined'

/** A collaboration on one of MY tables (owner view). */
export interface TableCollaboration {
  id: string
  collaboratorId: string
  name: string
  avatarUrl: string | null
  status: CollabStatus
  approveAll: boolean
  approvedModelIds: string[]
}

export interface IncomingCollabModel {
  id: string
  name: string
  thumbnail: string | null
  approved: boolean
}

/** A request addressed to ME (the model owner). */
export interface IncomingCollabRequest {
  id: string
  tableId: string
  tableName: string
  status: CollabStatus
  approveAll: boolean
  requesterId: string
  requesterName: string
  createdAt: string
  models: IncomingCollabModel[]
}

/** A reason a table can't be published (from the 409 on toggling visibility). */
export interface PublishBlocker {
  collaboratorId: string
  name: string
  reason: 'pending' | 'declined' | 'unapproved-models'
  modelNames: string[]
}

export const collaborationsApi = {
  /** Collaboration status for a table I own (drives the planner + Showcases UI). */
  getForTable: async (tableId: string): Promise<TableCollaboration[]> => {
    const res = await apiClient.get(`/api/tables/${tableId}/collaborations`)
    return res.data?.collaborations ?? []
  },

  /** Requests addressed to me, for the artist "Collaborations" page. */
  incoming: async (): Promise<IncomingCollabRequest[]> => {
    const res = await apiClient.get('/api/collaborations/incoming')
    return res.data?.requests ?? []
  },

  respond: async (
    id: string,
    payload: { decision: 'accept' | 'decline'; approveAll?: boolean; modelIds?: string[] },
  ): Promise<{ ok: boolean; status: CollabStatus }> => {
    const res = await apiClient.post(`/api/collaborations/${id}/respond`, payload)
    return res.data
  },
}
