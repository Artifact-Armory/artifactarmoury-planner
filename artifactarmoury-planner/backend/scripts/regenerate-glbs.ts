import 'dotenv/config'
import { db } from '../src/db'
import { generateGLB } from '../src/services/fileProcessor'
import { uploadToStorage, deleteFromStorage } from '../src/services/storage'
import path from 'path'
import { logger } from '../src/utils/logger'

async function regenerateGLBs() {
  try {
    // Get all assets with STL files
    const result = await db.query(`
      SELECT id, name, file_ref, glb_file_path 
      FROM assets 
      WHERE file_ref IS NOT NULL 
      AND glb_file_path IS NOT NULL
      LIMIT 10
    `)

    const assets = result.rows

    for (const asset of assets) {
      try {
        console.log(`\nRegenerating GLB for: ${asset.name} (${asset.id})`)
        
        // The file_ref is the storage path, we need to get the local path
        const stlPath = path.join(process.env.UPLOAD_DIR || './uploads', asset.file_ref)
        
        console.log(`STL path: ${stlPath}`)
        
        // Generate new GLB
        const newGlbPath = await generateGLB(stlPath)
        console.log(`Generated GLB at: ${newGlbPath}`)
        
        // Upload to storage
        const glbStoragePath = await uploadToStorage(newGlbPath, 'models')
        console.log(`Uploaded to storage: ${glbStoragePath}`)
        
        // Update database
        await db.query(
          `UPDATE assets SET glb_file_path = $1 WHERE id = $2`,
          [glbStoragePath, asset.id]
        )
        
        console.log(`✓ Updated asset ${asset.id}`)
      } catch (error) {
        console.error(`✗ Failed to regenerate GLB for ${asset.name}:`, error)
      }
    }

    console.log('\n✓ GLB regeneration complete')
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

regenerateGLBs()

