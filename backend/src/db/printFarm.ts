// backend/src/db/printFarm.ts
// Compile-safe placeholder for print farm integration.
// Replace with real provider client when ready.

export type PrintStatus = 'queued' | 'processing' | 'shipped' | 'failed' | 'cancelled'

export interface PrintRequest {
  modelId: string
  quantity: number
  notes?: string
  // add more fields as you define them (colour, material, etc.)
}

export interface PrintOrder {
  id: string
  status: PrintStatus
  externalId?: string
  createdAt: string
  updatedAt: string
  items?: Array<{ modelId: string; quantity: number }>
  metadata?: Record<string, unknown>
}

export interface PrintFarmClient {
  createOrder(req: PrintRequest): Promise<PrintOrder>
  getOrder(orderId: string): Promise<PrintOrder>
  cancelOrder(orderId: string): Promise<{ cancelled: true }>
}

class StubPrintFarm implements PrintFarmClient {
  async createOrder(req: PrintRequest): Promise<PrintOrder> {
    const now = new Date().toISOString()
    return {
      id: `stub_${Date.now()}`,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      items: [{ modelId: req.modelId, quantity: req.quantity }],
    }
  }

  async getOrder(orderId: string): Promise<PrintOrder> {
    const now = new Date().toISOString()
    // rotate a fake status for demo purposes
    const statuses: PrintStatus[] = ['queued', 'processing', 'shipped']
    const status = statuses[orderId.length % statuses.length]
    return {
      id: orderId,
      status,
      createdAt: now,
      updatedAt: now,
    }
  }

  async cancelOrder(orderId: string): Promise<{ cancelled: true }> {
    void orderId
    return { cancelled: true }
  }
}

export const printFarm: PrintFarmClient = new StubPrintFarm()
