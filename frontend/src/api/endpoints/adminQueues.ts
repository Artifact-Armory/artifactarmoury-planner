import apiClient from '../client'

const BASE_URL = '/api/admin/queues'

export type QueueName = 'ingest' | 'bake' | 'full_glb'

export interface QueueStats {
  queue: QueueName
  table: string
  enabled: boolean
  queued: number
  running: number
  failed: number
  oldestQueuedAgeSec: number | null
  stalledRunning: number
}

export interface WorkerInfo {
  workerId: string
  kind: string
  startedAt: string
  lastSeenAt: string
  ageSec: number
  jobsCompleted: number
  alive: boolean
}

export interface QueueProblem {
  key: string
  severity: 'critical' | 'warning'
  message: string
}

export interface StuckModel {
  id: string
  name: string
  artistName: string | null
  waitingSec: number
}

export interface QueueHealth {
  healthy: boolean
  checkedAt: string
  ingestWorkerRequired: boolean
  queues: QueueStats[]
  workers: WorkerInfo[]
  liveWorkers: number
  problems: QueueProblem[]
  stuckModels: StuckModel[]
}

export const adminQueuesApi = {
  async get(): Promise<QueueHealth> {
    const res = await apiClient.get(BASE_URL)
    return res.data
  },

  /** Hand a stuck/failed job back to the queue — the "uploads are stuck" fix. */
  async requeue(queue: QueueName, jobId: string): Promise<{ message: string }> {
    const res = await apiClient.post(`${BASE_URL}/${queue}/${jobId}/requeue`)
    return res.data
  },
}
