// backend/src/services/printFarm.ts
// Print farm integration service - adapter pattern for multiple print providers

import { logger } from '../utils/logger';
import { db } from '../db';
import type { Order, OrderItem, PrintJob, PrintJobStatus } from '../../../shared/types';

// ============================================================================
// TYPES
// ============================================================================

export interface PrintProvider {
  name: string;
  submitJob(job: PrintJobRequest): Promise<PrintJobResponse>;
  getJobStatus(jobId: string): Promise<PrintJobStatusResponse>;
  cancelJob(jobId: string): Promise<boolean>;
  estimateShipping(weight: number, destination: ShippingAddress): Promise<ShippingEstimate>;
}

export interface PrintJobRequest {
  orderId: string;
  orderNumber: string;
  items: PrintJobItem[];
  shipping: ShippingAddress;
  customerNotes?: string;
  priority: 'standard' | 'express';
}

export interface PrintJobItem {
  itemId: string;
  modelName: string;
  stlFilePath: string;
  quantity: number;
  color: string;
  material: string;
  quality: 'draft' | 'standard' | 'fine';
  specialInstructions?: string;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface PrintJobResponse {
  jobId: string;
  estimatedCompletionDate: Date;
  estimatedShipDate: Date;
  trackingAvailable: boolean;
}

export interface PrintJobStatusResponse {
  jobId: string;
  status: PrintJobStatus;
  progress: number; // 0-100
  currentStep: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: Date;
  message?: string;
}

export interface ShippingEstimate {
  cost: number;
  estimatedDays: number;
  service: string;
}

// ============================================================================
// MOCK PRINT PROVIDER (For Development)
// ============================================================================

class MockPrintProvider implements PrintProvider {
  name = 'Mock Print Farm';

  async submitJob(job: PrintJobRequest): Promise<PrintJobResponse> {
    logger.info('Mock print job submitted', { orderId: job.orderId });

    // Simulate processing
    const estimatedDays = job.priority === 'express' ? 3 : 7;
    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + estimatedDays);

    const shipDate = new Date(completionDate);
    shipDate.setDate(shipDate.getDate() + 1);

    return {
      jobId: `MOCK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      estimatedCompletionDate: completionDate,
      estimatedShipDate: shipDate,
      trackingAvailable: true
    };
  }

  async getJobStatus(jobId: string): Promise<PrintJobStatusResponse> {
    // Simulate progression based on time
    const jobAge = Date.now() - parseInt(jobId.split('-')[1] || '0');
    const hoursOld = jobAge / (1000 * 60 * 60);

    let status: PrintJobStatus = 'pending';
    let progress = 0;
    let currentStep = 'Order received';

    if (hoursOld > 72) {
      status = 'shipped';
      progress = 100;
      currentStep = 'Package shipped';
    } else if (hoursOld > 48) {
      status = 'printing';
      progress = 80;
      currentStep = 'Final quality check';
    } else if (hoursOld > 24) {
      status = 'printing';
      progress = 60;
      currentStep = 'Printing items';
    } else if (hoursOld > 2) {
      status = 'processing';
      progress = 30;
      currentStep = 'Preparing files';
    }

    const response: PrintJobStatusResponse = {
      jobId,
      status,
      progress,
      currentStep
    };

    if (status === 'shipped') {
      response.trackingNumber = `MOCK${jobId.substr(-8).toUpperCase()}`;
      response.trackingUrl = `https://tracking.example.com/${response.trackingNumber}`;
      const delivery = new Date();
      delivery.setDate(delivery.getDate() + 3);
      response.estimatedDelivery = delivery;
    }

    return response;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    logger.info('Mock print job cancelled', { jobId });
    return true;
  }

  async estimateShipping(weight: number, destination: ShippingAddress): Promise<ShippingEstimate> {
    // Simple mock calculation
    const baseRate = 5.99;
    const weightCost = weight * 0.5; // $0.50 per 100g
    const total = baseRate + weightCost;

    const isInternational = destination.country !== 'US';
    const estimatedDays = isInternational ? 14 : 5;

    return {
      cost: Math.round(total * 100) / 100,
      estimatedDays,
      service: isInternational ? 'International Standard' : 'Domestic Standard'
    };
  }
}

// ============================================================================
// CRAFTCLOUD PROVIDER (Example Real Integration)
// ============================================================================

class CraftCloudProvider implements PrintProvider {
  name = 'Craft Cloud';
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.CRAFTCLOUD_API_KEY || '';
    this.apiUrl = process.env.CRAFTCLOUD_API_URL || 'https://api.craftcloud3d.com/v1';
  }

  async submitJob(job: PrintJobRequest): Promise<PrintJobResponse> {
    try {
      // Convert our format to CraftCloud format
      const craftCloudPayload = {
        reference: job.orderNumber,
        items: job.items.map(item => ({
          file_url: this.getPublicFileUrl(item.stlFilePath),
          quantity: item.quantity,
          material: this.mapMaterial(item.material),
          color: item.color,
          quality: this.mapQuality(item.quality),
          notes: item.specialInstructions
        })),
        shipping: {
          recipient_name: job.shipping.name,
          address_line1: job.shipping.line1,
          address_line2: job.shipping.line2,
          city: job.shipping.city,
          state: job.shipping.state,
          postal_code: job.shipping.postalCode,
          country: job.shipping.country
        },
        priority: job.priority
      };

      const response = await fetch(`${this.apiUrl}/jobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(craftCloudPayload)
      });

      if (!response.ok) {
        throw new Error(`CraftCloud API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        jobId: data.job_id,
        estimatedCompletionDate: new Date(data.estimated_completion),
        estimatedShipDate: new Date(data.estimated_ship_date),
        trackingAvailable: data.tracking_enabled
      };
    } catch (error) {
      logger.error('Failed to submit CraftCloud job', { error, orderId: job.orderId });
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<PrintJobStatusResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`CraftCloud API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        jobId: data.job_id,
        status: this.mapStatus(data.status),
        progress: data.progress_percent,
        currentStep: data.current_step,
        trackingNumber: data.tracking_number,
        trackingUrl: data.tracking_url,
        estimatedDelivery: data.estimated_delivery ? new Date(data.estimated_delivery) : undefined,
        message: data.message
      };
    } catch (error) {
      logger.error('Failed to get CraftCloud job status', { error, jobId });
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.ok;
    } catch (error) {
      logger.error('Failed to cancel CraftCloud job', { error, jobId });
      return false;
    }
  }

  async estimateShipping(weight: number, destination: ShippingAddress): Promise<ShippingEstimate> {
    try {
      const response = await fetch(`${this.apiUrl}/shipping/estimate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          weight_grams: weight,
          destination: {
            country: destination.country,
            postal_code: destination.postalCode
          }
        })
      });

      const data = await response.json();

      return {
        cost: data.cost_usd,
        estimatedDays: data.estimated_days,
        service: data.service_name
      };
    } catch (error) {
      logger.error('Failed to estimate CraftCloud shipping', { error });
      // Return fallback estimate
      return {
        cost: 9.99,
        estimatedDays: 7,
        service: 'Standard'
      };
    }
  }

  // Helper methods
  private getPublicFileUrl(filePath: string): string {
    const baseUrl = process.env.PUBLIC_FILES_URL || 'https://files.terrainbuilder.com';
    return `${baseUrl}/${filePath}`;
  }

  private mapMaterial(material: string): string {
    const mapping: Record<string, string> = {
      'PLA': 'pla',
      'PETG': 'petg',
      'ABS': 'abs',
      'Resin': 'resin_standard'
    };
    return mapping[material] || 'pla';
  }

  private mapQuality(quality: string): string {
    const mapping: Record<string, string> = {
      'draft': 'low',
      'standard': 'medium',
      'fine': 'high'
    };
    return mapping[quality] || 'medium';
  }

  private mapStatus(craftCloudStatus: string): PrintJobStatus {
    const mapping: Record<string, PrintJobStatus> = {
      'pending': 'pending',
      'processing': 'processing',
      'queued': 'processing',
      'printing': 'printing',
      'post_processing': 'printing',
      'quality_check': 'printing',
      'packaging': 'printing',
      'shipped': 'shipped',
      'delivered': 'delivered',