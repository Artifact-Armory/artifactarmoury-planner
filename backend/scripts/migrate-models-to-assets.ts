// backend/scripts/migrate-models-to-assets.ts
// Copies published models into the new assets catalogue schema

import { db } from '../src/db';
import logger from '../src/utils/logger';

async function migrateModelsToAssets(): Promise<void> {
  console.log('\n🔄 Migrating published models into assets...\n');

  if (process.env.DB_MOCK === 'true') {
    console.warn('⚠️  DB_MOCK is enabled; skipping migration.');
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `
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
          base_price,
          status,
          visibility,
          view_count,
          add_count,
          use_count,
          created_at,
          updated_at,
          published_at,
          width,
          depth,
          height
        )
        SELECT
          m.id,
          m.artist_id,
          m.name,
          m.description,
          m.category,
          m.tags,
          m.stl_file_path AS file_ref,
          m.glb_file_path,
          COALESCE(m.glb_file_path, m.thumbnail_path) AS preview_url,
          m.thumbnail_path,
          m.base_price,
          CASE WHEN m.status = 'flagged' THEN 'archived' ELSE m.status END,
          m.visibility,
          m.view_count,
          0,
          0,
          m.created_at,
          m.updated_at,
          m.published_at,
          m.width,
          m.depth,
          m.height
        FROM models m
        WHERE m.status = 'published'
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
    );

    console.log(`✅ Migrated ${insertResult.rowCount} models into assets\n`);

    await client.query(
      `
        UPDATE assets a
        SET use_count = a.view_count
        WHERE EXISTS (SELECT 1 FROM models m WHERE m.id = a.id)
      `,
    );

    const favoritesResult = await client.query(
      `
        WITH favorite_counts AS (
          SELECT model_id, COUNT(*)::INT AS favorites
          FROM favorites
          GROUP BY model_id
        )
        UPDATE assets a
        SET add_count = favorite_counts.favorites
        FROM favorite_counts
        WHERE a.id = favorite_counts.model_id
      `,
    );

    await client.query('COMMIT');

    console.log(`📈 Updated telemetry for ${favoritesResult.rowCount} migrated assets\n`);
    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    logger.error('Model-to-asset migration failed', { error });
    process.exit(1);
  } finally {
    client.release();
    if (typeof (db as any).end === 'function') {
      await (db as any).end();
    }
  }
}

migrateModelsToAssets().catch((error) => {
  console.error('❌ Unexpected migration error:', error);
  process.exit(1);
});
