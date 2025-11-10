/**
 * Build script to temporarily move API routes during static export
 * 
 * This script moves the app/api directory out of the way during static export builds
 * since Next.js doesn't support API routes in static export mode.
 * 
 * IMPORTANT: This script ensures API routes are ALWAYS restored, even if build fails.
 */

const fs = require('fs')
const path = require('path')

const API_DIR = path.join(process.cwd(), 'app', 'api')
const API_BACKUP_DIR = path.join(process.cwd(), '_api-backup')

// Helper function to copy directory recursively
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`)
  }
  
  // Create destination directory
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  
  // Copy all files and subdirectories
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function moveApiDir() {
  try {
    // Clear Next.js cache to remove stale type definitions that reference API routes
    const nextDir = path.join(process.cwd(), '.next')
    if (fs.existsSync(nextDir)) {
      fs.rmSync(nextDir, { recursive: true, force: true })
      console.log('✓ Cleared Next.js cache (.next directory)')
    }

    // Check if API directory exists
    if (!fs.existsSync(API_DIR)) {
      console.log('⚠ Warning: API directory not found')
      console.log('  Attempting to restore from git...')
      try {
        const { execSync } = require('child_process')
        execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
        console.log('✓ Restored API directory from git')
      } catch (gitError) {
        console.error('✗ Failed to restore from git:', gitError.message)
        console.error('  Please ensure API routes exist before building')
        return false
      }
    }

    // Verify API routes exist before moving
    const routeFiles = [
      'app/api/ai-space/images/route.ts',
      'app/api/ai-space/route.ts',
      'app/api/booking/route.ts',
      'app/api/images/proxy/route.ts'
    ]
    
    const missingFiles = routeFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)))
    if (missingFiles.length > 0) {
      console.error('✗ Error: Missing API route files:', missingFiles)
      console.error('  Attempting to restore from git...')
      try {
        const { execSync } = require('child_process')
        execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
        console.log('✓ Restored missing files from git')
      } catch (gitError) {
        console.error('✗ Failed to restore from git:', gitError.message)
        return false
      }
    }

    // Move API directory to backup location
    if (fs.existsSync(API_BACKUP_DIR)) {
      // Clean up any existing backup
      fs.rmSync(API_BACKUP_DIR, { recursive: true, force: true })
    }

    // Try to rename, with fallback to copy+delete for Windows permission issues
    try {
      fs.renameSync(API_DIR, API_BACKUP_DIR)
    } catch (renameError) {
      // On Windows, rename can fail if files are locked (EPERM)
      // Fallback to copy + delete approach
      if (renameError.code === 'EPERM' || renameError.code === 'EBUSY') {
        console.log('⚠ Rename failed (files may be locked), using copy+delete approach...')
        try {
          // Copy directory recursively
          copyDirSync(API_DIR, API_BACKUP_DIR)
          // Delete original after successful copy
          fs.rmSync(API_DIR, { recursive: true, force: true })
          console.log('✓ Moved API directory using copy+delete method')
        } catch (copyError) {
          throw new Error(`Failed to move API directory: ${copyError.message}`)
        }
      } else {
        throw renameError
      }
    }
    
    console.log('✓ Temporarily moved API directory for static export')
    console.log(`  Backup location: ${API_BACKUP_DIR}`)
    
    // Verify backup was successful
    const backupRouteFiles = routeFiles.map(file => file.replace('app/api', '_api-backup'))
    const missingBackupFiles = backupRouteFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)))
    if (missingBackupFiles.length > 0) {
      console.error('✗ Error: Some files missing in backup:', missingBackupFiles)
      // Restore immediately
      fs.renameSync(API_BACKUP_DIR, API_DIR)
      return false
    }
    
    return true
  } catch (error) {
    console.error('✗ Error moving API directory:', error)
    return false
  }
}

function restoreApiDir() {
  try {
    // Restore API directory if backup exists
    if (fs.existsSync(API_BACKUP_DIR)) {
      // Always remove existing API dir if it exists (might be empty or corrupted)
      if (fs.existsSync(API_DIR)) {
        fs.rmSync(API_DIR, { recursive: true, force: true })
        console.log('✓ Removed existing API directory before restore')
      }
      
      // Try to rename, with fallback to copy+delete for Windows permission issues
      try {
        fs.renameSync(API_BACKUP_DIR, API_DIR)
      } catch (renameError) {
        // On Windows, rename can fail if files are locked (EPERM)
        // Fallback to copy + delete approach
        if (renameError.code === 'EPERM' || renameError.code === 'EBUSY') {
          console.log('⚠ Rename failed (files may be locked), using copy+delete approach...')
          try {
            // Copy directory recursively
            copyDirSync(API_BACKUP_DIR, API_DIR)
            // Delete backup after successful copy
            fs.rmSync(API_BACKUP_DIR, { recursive: true, force: true })
            console.log('✓ Restored API directory using copy+delete method')
          } catch (copyError) {
            throw new Error(`Failed to restore API directory: ${copyError.message}`)
          }
        } else {
          throw renameError
        }
      }
      
      console.log('✓ Restored API directory')
      
      // Verify restore was successful
      const routeFiles = [
        'app/api/ai-space/images/route.ts',
        'app/api/ai-space/route.ts',
        'app/api/booking/route.ts',
        'app/api/images/proxy/route.ts'
      ]
      
      const missingFiles = routeFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)))
      if (missingFiles.length > 0) {
        console.error('⚠ Warning: Some API route files are missing after restore:', missingFiles)
        console.error('  Attempting to restore from git...')
        try {
          const { execSync } = require('child_process')
          execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
          console.log('✓ Restored missing files from git')
          return true
        } catch (gitError) {
          console.error('✗ Failed to restore from git:', gitError.message)
          return false
        }
      }
      
      console.log('✓ Verified all API route files restored successfully')
      return true
    } else {
      // If backup doesn't exist, check if API directory exists
      if (fs.existsSync(API_DIR)) {
        // Verify files exist
        const routeFiles = [
          'app/api/ai-space/images/route.ts',
          'app/api/ai-space/route.ts',
          'app/api/booking/route.ts',
          'app/api/images/proxy/route.ts'
        ]
        const missingFiles = routeFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)))
        if (missingFiles.length > 0) {
          console.warn('⚠ Warning: Some API route files are missing:', missingFiles)
          console.warn('  Attempting to restore from git...')
          try {
            const { execSync } = require('child_process')
            execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
            console.log('✓ Restored missing files from git')
            return true
          } catch (gitError) {
            console.error('✗ Failed to restore from git:', gitError.message)
            return false
          }
        }
        console.log('✓ API directory already exists with all files, no restore needed')
        return true
      } else {
        console.warn('⚠ Warning: API backup not found and API directory missing')
        console.warn('  Attempting to restore from git...')
        // Try to restore from git if available
        try {
          const { execSync } = require('child_process')
          execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
          console.log('✓ Restored API directory from git')
          return true
        } catch (gitError) {
          console.error('✗ Failed to restore from git:', gitError.message)
          return false
        }
      }
    }
  } catch (error) {
    console.error('✗ Error restoring API directory:', error)
    // Try to restore from git as last resort
    try {
      console.log('  Attempting to restore from git...')
      const { execSync } = require('child_process')
      execSync('git checkout HEAD -- app/api', { stdio: 'inherit' })
      console.log('✓ Restored API directory from git')
      return true
    } catch (gitError) {
      console.error('✗ Failed to restore from git:', gitError.message)
      return false
    }
  }
}

// Handle process termination to ensure restore
process.on('SIGINT', () => {
  console.log('\n⚠ Interrupted - restoring API directory...')
  restoreApiDir()
  process.exit(1)
})

process.on('SIGTERM', () => {
  console.log('\n⚠ Terminated - restoring API directory...')
  restoreApiDir()
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('\n✗ Uncaught exception - restoring API directory...')
  restoreApiDir()
  throw error
})

// Run based on command line argument
const command = process.argv[2]

if (command === 'move') {
  const success = moveApiDir()
  process.exit(success ? 0 : 1)
} else if (command === 'restore') {
  const success = restoreApiDir()
  process.exit(success ? 0 : 1)
} else {
  console.log('Usage: node scripts/api-routes-handler.js [move|restore]')
  process.exit(1)
}
