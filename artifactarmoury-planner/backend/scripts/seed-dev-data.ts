// backend/scripts/seed-dev-data.ts
// Seed the database with development data

import { db } from '../src/db';
import { logger } from '../src/utils/logger';
import bcrypt from 'bcrypt';

async function seedData() {
  console.log('\n🌱 Seeding development data...\n');

  try {
    // Check if we're in production
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Cannot seed data in production environment!');
      process.exit(1);
    }

    // ========================================================================
    // USERS
    // ========================================================================

    console.log('Creating users...');

    const seededPassword = 'DemoArtist123';
    const passwordHash = await bcrypt.hash(seededPassword, 10);

    // Admin user
    const adminResult = await db.query(
      `INSERT INTO users (email, password_hash, display_name, role, email_verified)
       VALUES ('admin@terrainbuilder.com', $1, 'Admin User', 'admin', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = $1
       RETURNING id`,
      [passwordHash]
    );
    const adminId = adminResult.rows[0].id;
    console.log('✓ Admin user created');

    // Demo artist account
    await db.query('DELETE FROM users WHERE email = $1', ['demo@artifactarmoury.com'])

    const demoResult = await db.query(
      `INSERT INTO users (
        email, password_hash, display_name, role, artist_name,
        artist_bio, email_verified, commission_rate,
        stripe_onboarding_complete, creator_verified, verification_badge
      ) VALUES ($1, $2, 'Demo Artist', 'artist', 'Artifact Demo Studio',
        'Demo artist account for walkthroughs and testing.',
        true, 15.00, false, true, 'Trusted Creator')
      ON CONFLICT (email) DO UPDATE
      SET password_hash = $2,
          role = 'artist',
          artist_name = 'Artifact Demo Studio',
          artist_bio = 'Demo artist account for walkthroughs and testing.',
          email_verified = true,
          commission_rate = 15.00,
          stripe_onboarding_complete = false,
          creator_verified = true,
          verification_badge = 'Trusted Creator'
      RETURNING id`,
      ['demo@artifactarmoury.com', passwordHash]
    );
    const demoArtistId = demoResult.rows[0].id;
    console.log('✓ Demo artist account created (demo@artifactarmoury.com / DemoArtist123)');

    // Artist users
    const artists = [
    { name: 'Sarah Chen', email: 'sarah@example.com', artistName: 'Chen Designs' },
    { name: 'Mike Thompson', email: 'mike@example.com', artistName: 'Thompson Terrain' },
    { name: 'Alex Rivera', email: 'alex@example.com', artistName: 'Rivera Models' }
    ];

    const artistIds: string[] = [demoArtistId];

    for (const artist of artists) {
      const result = await db.query(
        `INSERT INTO users (
          email, password_hash, display_name, role, artist_name, 
          artist_bio, email_verified, commission_rate, stripe_onboarding_complete
        ) VALUES ($1, $2, $3, 'artist', $4, $5, true, 15.00, true)
        ON CONFLICT (email) DO UPDATE 
        SET password_hash = $2, artist_name = $4, artist_bio = $5
        RETURNING id`,
        [
          artist.email,
          passwordHash,
          artist.name,
          artist.artistName,
          `3D terrain artist specializing in tabletop gaming miniatures and scenery.`
        ]
      );
      artistIds.push(result.rows[0].id);
    }
    console.log(`✓ ${artists.length} artist users created`);

    // Customer users
    const customers = [
      { name: 'John Doe', email: 'john@example.com' },
      { name: 'Jane Smith', email: 'jane@example.com' }
    ];

    for (const customer of customers) {
      await db.query(
        `INSERT INTO users (email, password_hash, display_name, role, email_verified)
         VALUES ($1, $2, $3, 'customer', true)
         ON CONFLICT (email) DO UPDATE SET password_hash = $2`,
        [customer.email, passwordHash, customer.name]
      );
    }
    console.log(`✓ ${customers.length} customer users created`);

    // ========================================================================
    // INVITE CODES
    // ========================================================================

    console.log('\nCreating invite codes...');

    const inviteCodes = ['ARTIST2024', 'BETA2024', 'WELCOME'];

    for (const code of inviteCodes) {
      await db.query(
        `INSERT INTO invite_codes (code, created_by, max_uses, current_uses)
         VALUES ($1, $2, 10, 0)
         ON CONFLICT (code) DO NOTHING`,
        [code, adminId]
      );
    }
    console.log(`✓ ${inviteCodes.length} invite codes created`);

    // ========================================================================
    // MODELS
    // ========================================================================

    console.log('\nCreating models...');

    const categories = ['buildings', 'nature', 'scatter', 'props', 'complete_sets'];
    const modelNames = [
      'Medieval Tower', 'Ancient Ruins', 'Forest Trees Pack', 'Stone Bridge',
      'Tavern Building', 'Mountain Terrain', 'Village Houses', 'Castle Walls',
      'Desert Rocks', 'Dungeon Tiles', 'Wooden Fence', 'Market Stalls',
      'Cave Entrance', 'River Section', 'Town Square', 'Cottage'
    ];

    let modelCount = 0;

    for (let i = 0; i < modelNames.length; i++) {
      const artistId = artistIds[i % artistIds.length];
      const category = categories[i % categories.length];
      const basePrice = (Math.random() * 20 + 5).toFixed(2);

      await db.query(
        `INSERT INTO models (
          artist_id, name, description, category, tags,
          stl_file_path, glb_file_path, thumbnail_path,
          width, depth, height,
          base_price, estimated_print_time, estimated_material_cost,
          supports_required, recommended_layer_height, recommended_infill,
          status, visibility, published_at,
          view_count, sale_count
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          'published', 'public', CURRENT_TIMESTAMP,
          $18, $19
        )`,
        [
          artistId,
          modelNames[i],
          `High-quality ${modelNames[i].toLowerCase()} perfect for tabletop gaming. Optimized for FDM printing with minimal supports.`,
          category,
          ['terrain', 'tabletop', 'miniature', category],
          `models/${artistId}/sample-${i}.stl`,
          `models/${artistId}/sample-${i}.glb`,
          `thumbnails/${artistId}/thumb-${i}.jpg`,
          Math.floor(Math.random() * 100 + 50), // width
          Math.floor(Math.random() * 100 + 50), // depth
          Math.floor(Math.random() * 150 + 30), // height
          basePrice,
          Math.floor(Math.random() * 180 + 60), // print time (minutes)
          (Math.random() * 5 + 2).toFixed(2), // material cost
          Math.random() > 0.5,
          0.2,
          20,
          Math.floor(Math.random() * 200 + 50), // views
          Math.floor(Math.random() * 20) // sales
        ]
      );
      modelCount++;
    }
    console.log(`✓ ${modelCount} models created`);

    // ========================================================================
    // TABLES (Saved Layouts)
    // ========================================================================

    console.log('\nCreating table layouts...');

    const tableLayouts = [
      {
        name: 'Forest Battle Scene',
        description: 'Epic forest encounter with trees and terrain',
        width: 1200,
        depth: 900,
        isPublic: true
      },
      {
        name: 'Medieval Town',
        description: 'Complete medieval town layout',
        width: 1500,
        depth: 1200,
        isPublic: true
      }
    ];

    for (const table of tableLayouts) {
      const shareCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      await db.query(
        `INSERT INTO tables (
          user_id, name, description, width, depth, layout, is_public, share_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          artistIds[0],
          table.name,
          table.description,
          table.width,
          table.depth,
          JSON.stringify([
            { modelId: 'model-1', x: 100, y: 100, rotation: 0, scale: 1 },
            { modelId: 'model-2', x: 300, y: 200, rotation: 45, scale: 1 }
          ]),
          table.isPublic,
          shareCode
        ]
      );
    }
    console.log(`✓ ${tableLayouts.length} table layouts created`);

    // ========================================================================
    // SUMMARY
    // ========================================================================

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Development data seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`   • 1 Admin user`);
    console.log(`   • ${artists.length + 1} Artist users (including demo account)`);
    console.log(`   • ${customers.length} Customer users`);
    console.log(`   • ${inviteCodes.length} Invite codes`);
    console.log(`   • ${modelCount} Models`);
    console.log(`   • ${tableLayouts.length} Table layouts`);
    console.log('\n🔐 Login credentials:');
    console.log('   Email: admin@terrainbuilder.com (or any seeded user)');
    console.log(`   Password: ${seededPassword}`);
    console.log('   Demo Artist: demo@artifactarmoury.com / DemoArtist123');
    console.log('\n🎫 Invite codes: ARTIST2024, BETA2024, WELCOME');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    logger.info('Development data seeded successfully');

  } catch (error) {
    console.error('\n❌ Error seeding data:', error);
    logger.error('Failed to seed development data', { error });
    process.exit(1);
  } finally {
    await db.closePool();
  }
}

// Run the script
seedData();
