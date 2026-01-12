// src/core/pricing.ts
import type { Asset } from '@core/assets'

/**
 * FDM printing cost calculation for commercial print-on-demand service (UK pricing)
 * Includes material, machine time, labor, and overhead
 */
const MATERIAL_COST_PER_GRAM = 0.015 // £15/kg for PLA (UK pricing)
const MACHINE_COST_PER_HOUR = 0.40 // Machine amortization + electricity (£/hour)
const LABOR_PER_PRINT = 1.50 // Setup, removal, QC (UK pricing)
const AVERAGE_PRINT_SPEED = 25 // grams per hour (realistic for terrain with supports)
const OVERHEAD_MULTIPLIER = 1.25 // 25% markup for failures, shipping materials, etc.

export const COMMISSION_RATE = 0.20 // 20% commission on artist payment
export const REPEAT_MARGIN_RATE = 0.50 // You take 50% of original artist+commission as margin on repeats

export interface PricingBreakdown {
  firstPurchase: {
    artistCost: number
    commission: number
    printCost: number
    total: number
  }
  repeatPurchase: {
    commission: number
    printCost: number
    total: number
  }
  volume: number // cm³
  estimatedWeight: number // grams
}

/**
 * Calculate volume in cubic centimeters from AABB in meters
 */
function calculateVolume(aabb: { x: number; y: number; z: number }): number {
  const volumeCm3 = (aabb.x * 100) * (aabb.y * 100) * (aabb.z * 100)
  return volumeCm3
}

/**
 * Estimate material weight for hollow terrain piece
 * Optimized for realistic thin-walled tabletop terrain
 */
function estimateWeight(aabb: { x: number; y: number; z: number }): number {
  // Convert to cm
  const w = aabb.x * 100
  const h = aabb.y * 100
  const d = aabb.z * 100
  
  // Surface area method (more accurate for thin-walled hollow objects)
  const surfaceArea = 2 * (w * h + w * d + h * d) // cm²
  const wallThickness = 0.08 // 0.8mm effective (2-3 perimeters at 0.4mm nozzle)
  const shellVolume = surfaceArea * wallThickness
  
  // Add minimal infill (3% gyroid infill of interior volume)
  const innerVolume = Math.max(0, (w - 0.16) * (h - 0.16) * (d - 0.16))
  const infillVolume = innerVolume * 0.03
  
  // Add 10% for supports and waste
  const totalVolume = (shellVolume + infillVolume) * 1.10
  
  // PLA density: 1.24 g/cm³
  const weight = totalVolume * 1.24
  
  return Math.max(10, weight) // Minimum 10g
}

/**
 * Calculate realistic commercial print cost
 */
function calculatePrintCost(weightGrams: number): number {
  // Material cost
  const materialCost = weightGrams * MATERIAL_COST_PER_GRAM
  
  // Print time based on realistic deposition rate
  const printTimeHours = weightGrams / AVERAGE_PRINT_SPEED
  
  // Machine time cost
  const machineCost = printTimeHours * MACHINE_COST_PER_HOUR
  
  // Total before overhead
  const baseCost = materialCost + machineCost + LABOR_PER_PRINT
  
  // Add overhead for failures, packaging, etc.
  const totalCost = baseCost * OVERHEAD_MULTIPLIER
  
  return totalCost
}

/**
 * Calculate full pricing breakdown for an asset
 * 
 * PRICING MODEL:
 * - First purchase: Artist Cost + Your Commission (20% of artist cost) + Print Cost
 * - Repeat purchase: Your Margin (50% of original artist+commission) + Print Cost
 * 
 * This gives customers a solid discount on duplicates while you keep a healthy margin
 */
export function calculatePricing(asset: Asset): PricingBreakdown {
  if (!asset.price) {
    throw new Error(`Asset ${asset.id} has no base price defined`)
  }

  const volume = calculateVolume(asset.aabb)
  const estimatedWeight = estimateWeight(asset.aabb)
  const printCost = calculatePrintCost(estimatedWeight)
  
  // First purchase breakdown:
  // asset.price is the TOTAL customer pays (artist + commission + print)
  const firstTotal = asset.price
  
  // Back-calculate: firstTotal = artistCost + (artistCost × 0.20) + printCost
  // firstTotal = artistCost × 1.20 + printCost
  // artistCost = (firstTotal - printCost) / 1.20
  const artistCost = (firstTotal - printCost) / 1.20
  const firstCommission = artistCost * COMMISSION_RATE
  
  // Repeat purchase: Take 50% of what artist+commission was as your margin
  // This gives customer a discount while you still profit well
  const originalArtistPlusCommission = artistCost + firstCommission
  const repeatCommission = originalArtistPlusCommission * REPEAT_MARGIN_RATE
  const repeatTotal = repeatCommission + printCost
  
  const customerSavings = firstTotal - repeatTotal
  const savingsPercent = (customerSavings / firstTotal) * 100
  
  console.log(`💰 Pricing for ${asset.name}:`)
  console.log(`  📦 Volume: ${volume.toFixed(1)} cm³`)
  console.log(`  ⚖️  Weight: ${estimatedWeight.toFixed(1)}g`)
  console.log(`  🖨️  Print Cost: £${printCost.toFixed(2)}`)
  console.log(`  `)
  console.log(`  🆕 First Purchase:`)
  console.log(`     Artist: £${artistCost.toFixed(2)}`)
  console.log(`     Your Cut: £${firstCommission.toFixed(2)}`)
  console.log(`     Print: £${printCost.toFixed(2)}`)
  console.log(`     → Customer pays: £${firstTotal.toFixed(2)}`)
  console.log(`  `)
  console.log(`  🔁 Repeat Purchase:`)
  console.log(`     Your Margin: £${repeatCommission.toFixed(2)} (${(REPEAT_MARGIN_RATE * 100).toFixed(0)}% of original artist+commission)`)
  console.log(`     Print: £${printCost.toFixed(2)}`)
  console.log(`     → Customer pays: £${repeatTotal.toFixed(2)}`)
  console.log(`  `)
  console.log(`  💚 Customer Saves: £${customerSavings.toFixed(2)} (${savingsPercent.toFixed(0)}% off) per duplicate`)
  console.log(`  📊 Your profit per duplicate: £${repeatCommission.toFixed(2)} vs £${firstCommission.toFixed(2)} on first`)
  
  return {
    firstPurchase: {
      artistCost: artistCost,
      commission: firstCommission,
      printCost: printCost,
      total: firstTotal
    },
    repeatPurchase: {
      commission: repeatCommission,
      printCost: printCost,
      total: repeatTotal
    },
    volume: volume,
    estimatedWeight: estimatedWeight
  }
}

/**
 * Basket item tracking first vs repeat purchase
 */
export interface BasketItem {
  assetId: string
  quantity: number
  isFirstPurchase: boolean // DEPRECATED - use firstQty/repeatQty instead
  firstQty?: number // How many at first purchase price
  repeatQty?: number // How many at repeat purchase price
}

/**
 * Calculate total basket cost
 */
export interface BasketSummary {
  items: Array<{
    asset: Asset
    quantity: number
    isFirstPurchase: boolean
    unitPrice: number
    lineTotal: number
    firstQty?: number
    repeatQty?: number
  }>
  subtotal: number
  breakdown: {
    artistCosts: number
    yourRevenue: number // Your total profit (commission + repeat margins)
    printCosts: number
  }
}

export function calculateBasketTotal(
  basketItems: BasketItem[],
  assetsById: Map<string, Asset>
): BasketSummary {
  let subtotal = 0
  let totalArtistCosts = 0
  let totalYourRevenue = 0
  let totalPrintCosts = 0

  const items = basketItems
    .filter(item => {
      const asset = assetsById.get(item.assetId)
      if (!asset) {
        console.warn(`Asset ${item.assetId} not found in assets map, removing from basket`)
        return false
      }
      return true
    })
    .map(item => {
    const asset = assetsById.get(item.assetId)
    if (!asset) throw new Error(`Asset ${item.assetId} not found`)

    const pricing = calculatePricing(asset)
    
    const firstQty = item.firstQty ?? (item.isFirstPurchase ? 1 : 0)
    const repeatQty = item.repeatQty ?? Math.max(0, item.quantity - firstQty)
    
    // First purchase costs
    const firstCost = pricing.firstPurchase.total * firstQty
    totalArtistCosts += pricing.firstPurchase.artistCost * firstQty
    totalYourRevenue += pricing.firstPurchase.commission * firstQty
    totalPrintCosts += pricing.firstPurchase.printCost * firstQty
    
    // Repeat purchase costs
    const repeatCost = pricing.repeatPurchase.total * repeatQty
    totalYourRevenue += pricing.repeatPurchase.commission * repeatQty
    totalPrintCosts += pricing.repeatPurchase.printCost * repeatQty
    
    const lineTotal = firstCost + repeatCost
    subtotal += lineTotal
    
    // Weighted average unit price for display
    const totalQty = firstQty + repeatQty
    const unitPrice = totalQty > 0 ? lineTotal / totalQty : 0
    const isFirstPurchase = firstQty > 0

    return {
      asset,
      quantity: item.quantity,
      isFirstPurchase,
      unitPrice,
      lineTotal,
      firstQty,
      repeatQty
    }
  })

  return {
    items,
    subtotal,
    breakdown: {
      artistCosts: totalArtistCosts,
      yourRevenue: totalYourRevenue,
      printCosts: totalPrintCosts
    }
  }
}