import { db, closeDatabase } from '../src/db'
import { logger } from '../src/utils/logger'

async function migrateModelsToAssets(): Promise<void> {
  const scriptLogger = logger.child('MODEL_TO_ASSET_MIGRATION')
  scriptLogger.info('🔄 Starting model to asset migration')

  try {
    await db.query('BEGIN')

    const insertResult = await db.query(`
      INSERT INTO assets (
        id,
        artist_id,
        name,
        description,
        category,
        tags,
        file_ref,
        glb_file_path,
        preview_url,
        thumbnail_path,
        dimensions_mm,
        poly_count,
        base_price,
        status,
        visibility,
        view_count,
        created_at,
        updated_at,
        published_at
      )
      SELECT
        id,
        artist_id,
        name,
        description,
        category,
        tags,
        stl_file_path AS file_ref,
        glb_file_path,
        thumbnail_path AS preview_url,
        thumbnail_path,
        jsonb_build_object(
          'x', width,
          'y', depth,
          'z', height
        ) AS dimensions_mm,
        NULL AS poly_count,
        base_price,
        status,
        visibility,
        view_count,
        created_at,
        updated_at,
        published_at
      FROM models
      WHERE status = 'published'
      ON CONFLICT (id) DO NOTHING
    `)

    scriptLogger.info('✅ Models migrated to assets table', {
      migratedCount: insertResult.rowCount,
    })

    await db.query(`
      UPDATE assets a
      SET
        add_count = COALESCE((
          SELECT COUNT(*) FROM favorites WHERE model_id = a.id
        ), 0),
        use_count = a.view_count
      WHERE EXISTS (SELECT 1 FROM models WHERE id = a.id)
    `)

    await db.query('COMMIT')

    scriptLogger.info('🎉 Migration completed successfully')
    scriptLogger.warn(
      'Original models table is preserved. Review data and drop legacy tables once verified.',
    )
  } catch (error) {
    await db.query('ROLLBACK')
    scriptLogger.error('❌ Migration failed', { error })
    process.exitCode = 1
  } finally {
    await closeDatabase()
  }
}

migrateModelsToAssets().catch((error) => {
  logger.error('Unhandled migration error', { error })
  process.exit(1)
})
