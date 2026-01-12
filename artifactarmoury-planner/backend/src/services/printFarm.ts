// backend/src/services/printFarm.ts
// Minimal stub to satisfy routes; integrate real provider later

export interface SubmitPrintJobParams {
  orderId: string
  orderNumber: string
  items: Array<{
    itemId: string
    modelName: string
    stlFilePath: string
    quantity: number
    color?: string
    material?: string
    quality?: string
    specialInstructions?: string | null
  }>
  shipping: {
    name: string
    line1: string
    line2?: string | null
    city: string
    state?: string | null
    postalCode: string
    country: string
  }
  priority?: 'standard' | 'rush'
}

export async function submitPrintJob(params: SubmitPrintJobParams): Promise<{ jobId: string }>
{
  void params
  return { jobId: `print_${Date.now()}` }
}

export default { submitPrintJob }

