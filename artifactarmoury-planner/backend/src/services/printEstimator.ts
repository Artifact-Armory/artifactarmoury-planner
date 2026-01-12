// backend/src/services/printEstimator.ts
import logger from '../utils/logger'
import type { PrintOptions, PrintStats } from '../types/shared'

// ============================================================================
// PRICING CONSTANTS
// ============================================================================

// Base costs per gram of material (in GBP)
const MATERIAL_BASE_COSTS = {
  pla: 0.03,      // £0.03 per gram
  abs: 0.035,     // £0.035 per gram
  petg: 0.04,     // £0.04 per gram
  resin: 0.12,    // £0.12 per gram (more expensive)
  tpu: 0.05,      // £0.05 per gram (flexible)
  nylon: 0.06     // £0.06 per gram (strong)
}

// Quality multipliers (affect print time and cost)
const QUALITY_MULTIPLIERS = {
  draft: {
    cost: 0.7,      // 30% cheaper (faster, less detail)
    time: 0.6       // 40% faster
  },
  standard: {
    cost: 1.0,      // Base cost
    time: 1.0       // Base time
  },
  fine: {
    cost: 1.4,      // 40% more expensive (slower, more detail)
    time: 1.6       // 60% slower
  },
  ultra: {
    cost: 1.8,      // 80% more expensive (very slow, highest detail)
    time: 2.2       // 120% slower
  }
}

// Fixed costs
const SETUP_COST = 2.50      // £2.50 per model (setup, cleanup, QA)
const LABOR_COST_PER_HOUR = 12.00 // £12/hour labor
const ELECTRICITY_COST_PER_HOUR = 0.15 // £0.15/hour electricity

// Infill percentages affect material usage
const INFILL_MATERIAL_FACTORS = {
  0: 0.15,    // 0% infill (hollow) uses 15% material
  10: 0.25,   // 10% infill
  15: 0.30,   // 15% infill
  20: 0.40,   // 20% infill (default)
  30: 0.55,   // 30% infill
  50: 0.75,   // 50% infill
  100: 1.0    // 100% infill (solid)
}

// Shipping costs by weight (UK domestic)
const SHIPPING_TIERS = [
  { maxWeight: 100, cost: 2.95 },      // Up to 100g - £2.95
  { maxWeight: 250, cost: 3.95 },      // Up to 250g - £3.95
  { maxWeight: 500, cost: 5.95 },      // Up to 500g - £5.95
  { maxWeight: 1000, cost: 7.95 },     // Up to 1kg - £7.95
  { maxWeight: 2000, cost: 9.95 },     // Up to 2kg - £9.95
  { maxWeight: 5000, cost: 14.95 },    // Up to 5kg - £14.95
  { maxWeight: Infinity, cost: 19.95 } // Over 5kg - £19.95
]

// International shipping multiplier
const INTERNATIONAL_SHIPPING_MULTIPLIER = 2.5

// ============================================================================
// PRINT COST ESTIMATION
// ============================================================================

export interface PrintCostEstimate {
  material_cost: number
  labor_cost: number
  electricity_cost: number
  setup_cost: number
  total_cost: number
  estimated_time_hours: number
  material_weight_g: number
}

/**
 * Estimate print cost based on model stats and print options
 */
export function estimatePrintCost(
  printStats: PrintStats,
  printOptions?: PrintOptions
): PrintCostEstimate {
  try {
    // Default values if not provided
    const material = printOptions?.material || 'pla'
    const quality = printOptions?.quality || 'standard'
    const infill = printOptions?.infill || 20
    
    // Get base material cost per gram
    const materialCostPerGram = MATERIAL_BASE_COSTS[material as keyof typeof MATERIAL_BASE_COSTS] || MATERIAL_BASE_COSTS.pla
    
    // Get quality multipliers
    const qualityMult = QUALITY_MULTIPLIERS[quality as keyof typeof QUALITY_MULTIPLIERS] || QUALITY_MULTIPLIERS.standard
    
    // Get infill factor
    const infillFactor = INFILL_MATERIAL_FACTORS[infill as keyof typeof INFILL_MATERIAL_FACTORS] || INFILL_MATERIAL_FACTORS[20]
    
    // Calculate actual material weight (volume * density * infill factor)
    // Using estimated_weight_g from print stats, or calculate from volume
    let materialWeightG: number
    
    if (printStats.estimated_weight_g) {
      materialWeightG = printStats.estimated_weight_g * infillFactor
    } else if (printStats.volume_mm3) {
      // Default PLA density is ~1.24 g/cm³ = 0.00124 g/mm³
      const density = getMaterialDensity(material)
      materialWeightG = printStats.volume_mm3 * density * infillFactor
    } else {
      // Fallback: estimate based on bounding box or default
      materialWeightG = 50 // Default 50g if no data
      logger.warn('No weight or volume data available, using default weight', { printStats })
    }
    
    // Material cost
    const materialCost = materialWeightG * materialCostPerGram * qualityMult.cost
    
    // Estimate print time in hours
    let estimatedTimeHours: number
    
    if (printStats.estimated_print_time_minutes) {
      estimatedTimeHours = (printStats.estimated_print_time_minutes / 60) * qualityMult.time
    } else {
      // Rough estimate: 1g per 2 minutes at standard quality
      estimatedTimeHours = (materialWeightG / 30) * qualityMult.time
    }
    
    // Labor cost (typically 10% of print time for setup and QA)
    const laborTimeHours = estimatedTimeHours * 0.1
    const laborCost = laborTimeHours * LABOR_COST_PER_HOUR
    
    // Electricity cost
    const electricityCost = estimatedTimeHours * ELECTRICITY_COST_PER_HOUR
    
    // Total cost
    const totalCost = materialCost + laborCost + electricityCost + SETUP_COST
    
    return {
      material_cost: Number(materialCost.toFixed(2)),
      labor_cost: Number(laborCost.toFixed(2)),
      electricity_cost: Number(electricityCost.toFixed(2)),
      setup_cost: SETUP_COST,
      total_cost: Number(totalCost.toFixed(2)),
      estimated_time_hours: Number(estimatedTimeHours.toFixed(2)),
      material_weight_g: Number(materialWeightG.toFixed(2))
    }
  } catch (error) {
    logger.error('Error estimating print cost', { error, printStats, printOptions })
    
    // Return fallback estimate
    return {
      material_cost: 5.00,
      labor_cost: 2.00,
      electricity_cost: 0.50,
      setup_cost: SETUP_COST,
      total_cost: 10.00,
      estimated_time_hours: 3.0,
      material_weight_g: 50
    }
  }
}

/**
 * Get material density in g/mm³
 */
function getMaterialDensity(material: string): number {
  const densities: Record<string, number> = {
    pla: 0.00124,      // 1.24 g/cm³
    abs: 0.00105,      // 1.05 g/cm³
    petg: 0.00127,     // 1.27 g/cm³
    resin: 0.00112,    // 1.12 g/cm³
    tpu: 0.00120,      // 1.20 g/cm³
    nylon: 0.00114     // 1.14 g/cm³
  }
  
  return densities[material] || densities.pla
}

// ============================================================================
// SHIPPING COST CALCULATION
// ============================================================================

export interface ShippingCostEstimate {
  weight_g: number
  cost: number
  tier: string
  international: boolean
}

/**
 * Calculate shipping cost based on total weight
 */
export function calculateShippingCost(
  totalWeightG: number,
  isInternational = false
): ShippingCostEstimate {
  // Find appropriate shipping tier
  const tier = SHIPPING_TIERS.find(t => totalWeightG <= t.maxWeight)
  
  if (!tier) {
    logger.error('No shipping tier found for weight', { totalWeightG })
    return {
      weight_g: totalWeightG,
      cost: 19.95,
      tier: 'over_5kg',
      international: isInternational
    }
  }
  
  let cost = tier.cost
  
  // Apply international multiplier if needed
  if (isInternational) {
    cost *= INTERNATIONAL_SHIPPING_MULTIPLIER
  }
  
  return {
    weight_g: totalWeightG,
    cost: Number(cost.toFixed(2)),
    tier: getTierName(tier.maxWeight),
    international: isInternational
  }
}

function getTierName(maxWeight: number): string {
  if (maxWeight <= 100) return 'up_to_100g'
  if (maxWeight <= 250) return 'up_to_250g'
  if (maxWeight <= 500) return 'up_to_500g'
  if (maxWeight <= 1000) return 'up_to_1kg'
  if (maxWeight <= 2000) return 'up_to_2kg'
  if (maxWeight <= 5000) return 'up_to_5kg'
  return 'over_5kg'
}

// ============================================================================
// ORDER PRICING
// ============================================================================

export interface OrderPricingBreakdown {
  items: Array<{
    asset_id: string
    quantity: number
    unit_price: number
    print_cost: number
    subtotal: number
  }>
  model_subtotal: number
  print_subtotal: number
  shipping: number
  platform_fee: number
  total: number
}

/**
 * Calculate complete order pricing including first/repeat discounts
 */
export function calculateOrderPricing(
  items: Array<{
    asset_id: string
    asset_base_price: number
    quantity: number
    print_stats: PrintStats
    print_options?: PrintOptions
    is_first_purchase: boolean
  }>,
  shippingCountry: string = 'GB'
): OrderPricingBreakdown {
  const isInternational = shippingCountry !== 'GB'
  let modelSubtotal = 0
  let printSubtotal = 0
  let totalWeightG = 0
  
  const itemBreakdowns = items.map(item => {
    const {
      asset_id,
      asset_base_price,
      quantity,
      print_stats,
      print_options,
      is_first_purchase
    } = item
    
    // Calculate print cost per unit
    const printCost = estimatePrintCost(print_stats, print_options)
    totalWeightG += printCost.material_weight_g * quantity
    
    // First purchase gets full price, repeats get 75% off model price
    const firstQuantity = is_first_purchase ? Math.min(quantity, 1) : 0
    const repeatQuantity = quantity - firstQuantity
    
    const firstPrice = asset_base_price
    const repeatPrice = asset_base_price * 0.25 // 75% discount
    
    const modelCost = (firstPrice * firstQuantity) + (repeatPrice * repeatQuantity)
    const totalPrintCost = printCost.total_cost * quantity
    
    modelSubtotal += modelCost
    printSubtotal += totalPrintCost
    
    return {
      asset_id,
      quantity,
      unit_price: asset_base_price,
      print_cost: printCost.total_cost,
      subtotal: modelCost + totalPrintCost
    }
  })
  
  // Calculate shipping
  const shippingCost = calculateShippingCost(totalWeightG, isInternational)
  
  // Platform fee (20% of model subtotal)
  const platformFee = modelSubtotal * 0.20
  
  // Total
  const total = modelSubtotal + printSubtotal + shippingCost.cost
  
  return {
    items: itemBreakdowns,
    model_subtotal: Number(modelSubtotal.toFixed(2)),
    print_subtotal: Number(printSubtotal.toFixed(2)),
    shipping: shippingCost.cost,
    platform_fee: Number(platformFee.toFixed(2)),
    total: Number(total.toFixed(2))
  }
}

// ============================================================================
// PRINT TIME ESTIMATION
// ============================================================================

export interface PrintTimeEstimate {
  hours: number
  minutes: number
  formatted: string
}

/**
 * Format print time estimate
 */
export function formatPrintTime(hours: number): PrintTimeEstimate {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  
  let formatted = ''
  if (h > 0) formatted += `${h}h `
  formatted += `${m}m`
  
  return {
    hours: Number(hours.toFixed(2)),
    minutes: totalMinutes,
    formatted: formatted.trim()
  }
}

// ============================================================================
// MATERIAL RECOMMENDATIONS
// ============================================================================

export interface MaterialRecommendation {
  material: string
  suitability: 'excellent' | 'good' | 'fair' | 'poor'
  reason: string
  cost_multiplier: number
}

/**
 * Recommend materials based on model characteristics
 */
export function recommendMaterials(printStats: PrintStats): MaterialRecommendation[] {
  const recommendations: MaterialRecommendation[] = []
  
  // Check surface area to volume ratio (indicates thin features)
  const surfaceToVolume = printStats.surface_area_mm2 && printStats.volume_mm3
    ? printStats.surface_area_mm2 / printStats.volume_mm3
    : 0
  
  const hasThinFeatures = surfaceToVolume > 0.5
  
  // PLA - great for most prints
  recommendations.push({
    material: 'pla',
    suitability: 'excellent',
    reason: 'Best for most terrain pieces. Easy to print, good detail.',
    cost_multiplier: 1.0
  })
  
  // Resin - excellent for high detail
  if (printStats.triangle_count && printStats.triangle_count > 100000) {
    recommendations.push({
      material: 'resin',
      suitability: 'excellent',
      reason: 'Excellent for highly detailed models. Smoother surface finish.',
      cost_multiplier: 4.0
    })
  }
  
  // ABS - better durability
  recommendations.push({
    material: 'abs',
    suitability: 'good',
    reason: 'More durable than PLA. Better for gaming pieces that see heavy use.',
    cost_multiplier: 1.17
  })
  
  // PETG - if model might need flexibility
  if (!hasThinFeatures) {
    recommendations.push({
      material: 'petg',
      suitability: 'good',
      reason: 'Good strength and slight flexibility. Weather resistant.',
      cost_multiplier: 1.33
    })
  }
  
  return recommendations
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  estimatePrintCost,
  calculateShippingCost,
  calculateOrderPricing,
  formatPrintTime,
  recommendMaterials,
  MATERIAL_BASE_COSTS,
  QUALITY_MULTIPLIERS,
  SHIPPING_TIERS
}
