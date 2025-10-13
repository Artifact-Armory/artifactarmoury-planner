// backend/scripts/generate-invite.ts
// CLI script to generate artist invite codes

import { db } from '../src/db';
import { logger } from '../src/utils/logger';
import crypto from 'crypto';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function generateInvite() {
  console.log('\n🎫 Generate Artist Invite Code\n');
  console.log('This script creates invitation codes for artist registration.\n');

  try {
    // Get parameters
    const maxUsesInput = await question('Maximum uses (default: 1): ');
    const maxUses = maxUsesInput ? parseInt(maxUsesInput) : 1;

    if (isNaN(maxUses) || maxUses < 1) {
      console.error('❌ Invalid max uses. Must be a positive number.');
      process.exit(1);
    }

    const expiryDaysInput = await question('Expires in days (leave empty for no expiry): ');
    let expiresAt = null;
    
    if (expiryDaysInput) {
      const days = parseInt(expiryDaysInput);
      if (isNaN(days) || days < 1) {
        console.error('❌ Invalid expiry days. Must be a positive number.');
        process.exit(1);
      }
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);
    }

    // Find admin user (or use system)
    const adminResult = await db.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
    );

    const createdBy = adminResult.rows.length > 0 ? adminResult.rows[0].id : null;

    // Generate code
    const code = generateInviteCode();

    // Insert into database
    const result = await db.query(
      `INSERT INTO invite_codes (code, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, max_uses, expires_at, created_at`,
      [code, createdBy, maxUses, expiresAt]
    );

    const invite = result.rows[0];

    console.log('\n✅ Invite code generated successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Code:       ${invite.code}`);
    console.log(`Max Uses:   ${invite.max_uses}`);
    console.log(`Expires:    ${invite.expires_at ? invite.expires_at.toLocaleDateString() : 'Never'}`);
    console.log(`Created:    ${invite.created_at.toLocaleString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Share this code with artists to allow registration:\n`);
    console.log(`   ${invite.code}\n`);

    // Log to system
    logger.info('Invite code generated via CLI', {
      code: invite.code,
      maxUses: invite.max_uses,
      expiresAt: invite.expires_at
    });

  } catch (error) {
    console.error('\n❌ Error generating invite code:', error);
    logger.error('Failed to generate invite code', { error });
    process.exit(1);
  } finally {
    rl.close();
    await db.closePool();
  }
}

// Run the script
generateInvite();