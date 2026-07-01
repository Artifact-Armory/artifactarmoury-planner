// backend/src/services/modelSimilarity.ts
// Utility helpers for similarity detection between models

import { db } from '../db'
import logger from '../utils/logger'
import { cosineSimilarity } from './watermark'

interface SimilarModel {
  modelId: string
  similarity: number
  watermarkToken: string
}

/**
 * Compare a feature vector against stored watermarks to find similar models.
 */
export async function findSimilarModels(
  featureVector: number[],
  options: { limit?: number; minSimilarity?: number; excludeModelId?: string } = {}
): Promise<SimilarModel[]> {
  const limit = options.limit ?? 10
  const minSimilarity = options.minSimilarity ?? 0.92

  try {
    const result = await db.query(
      `
        SELECT
          model_id,
          watermark_token,
          metadata ->> 'featureVector' AS feature_json
        FROM model_watermarks
        WHERE ($1::uuid IS NULL OR model_id <> $1::uuid)
      `,
      [options.excludeModelId ?? null]
    )

    const matches: SimilarModel[] = []

    for (const row of result.rows) {
      if (!row.feature_json) continue
      const candidateVector: number[] = JSON.parse(row.feature_json)
      const score = cosineSimilarity(featureVector, candidateVector)
      if (score >= minSimilarity) {
        matches.push({
          modelId: row.model_id,
          similarity: Number(score.toFixed(4)),
          watermarkToken: row.watermark_token,
        })
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity)
    return matches.slice(0, limit)
  } catch (error) {
    logger.error('Failed to compute similar models', { error })
    throw error
  }
}
