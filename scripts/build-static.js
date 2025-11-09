#!/usr/bin/env node
/**
 * Build wrapper script that ensures API routes are always restored
 * Works cross-platform (Windows, Linux, macOS)
 */

const { execSync } = require('child_process')
const path = require('path')

const API_HANDLER = path.join(__dirname, 'api-routes-handler.js')

function runCommand(command, description) {
  try {
    console.log(`\n${description}...`)
    execSync(command, { stdio: 'inherit' })
    return true
  } catch (error) {
    console.error(`\n✗ ${description} failed`)
    return false
  }
}

// Always restore API routes and admin pages on exit
function ensureRestore() {
  try {
    execSync(`node "${API_HANDLER}" restore`, { stdio: 'inherit' })
  } catch (error) {
    console.error('Failed to restore API routes:', error.message)
  }
  
  // Restore admin pages
  const adminDir = path.join(process.cwd(), 'app', 'admin')
  const adminBackup = path.join(process.cwd(), '_admin-backup')
  const fs = require('fs')
  if (fs.existsSync(adminBackup)) {
    try {
      if (fs.existsSync(adminDir)) {
        fs.rmSync(adminDir, { recursive: true, force: true })
      }
      fs.renameSync(adminBackup, adminDir)
    } catch (error) {
      console.error('Failed to restore admin directory:', error.message)
    }
  }
}

// Setup cleanup handlers
process.on('SIGINT', () => {
  ensureRestore()
  process.exit(1)
})

process.on('SIGTERM', () => {
  ensureRestore()
  process.exit(1)
})

process.on('exit', (code) => {
  if (code !== 0) {
    ensureRestore()
  }
})

// Run build process
console.log('🚀 Starting static export build...\n')

// Step 1: Generate thumbnails
if (!runCommand('npm run generate:thumbnails', 'Generating image thumbnails')) {
  process.exit(1)
}

// Step 2: Generate manifest
if (!runCommand('npm run generate:manifest', 'Generating image manifest')) {
  process.exit(1)
}

// Step 3: Move API routes and admin pages (they require server-side features)
if (!runCommand(`node "${API_HANDLER}" move`, 'Moving API routes')) {
  process.exit(1)
}

// Also move admin pages (they use dynamic features and can't be statically exported)
const adminDir = path.join(process.cwd(), 'app', 'admin')
const adminBackup = path.join(process.cwd(), '_admin-backup')
const fs = require('fs')
if (fs.existsSync(adminDir)) {
  try {
    if (fs.existsSync(adminBackup)) {
      fs.rmSync(adminBackup, { recursive: true, force: true })
    }
    fs.renameSync(adminDir, adminBackup)
    console.log('✓ Temporarily moved admin directory for static export')
    console.log(`  Backup location: ${adminBackup}`)
  } catch (error) {
    console.error('✗ Failed to move admin directory:', error.message)
    process.exit(1)
  }
}

// Step 4: Build static export
let buildSuccess = false
try {
  // Set environment variables explicitly for cross-platform compatibility
  // This works on all platforms (Windows, Linux, macOS) without requiring cross-env
  const buildEnv = {
    ...process.env, // Inherit all environment variables (including workflow env vars)
    NODE_ENV: 'production', // Explicitly set to ensure production mode
    STATIC_EXPORT: 'true' // Explicitly set to ensure static export
  }
  
  // Use cross-env if available, otherwise set env vars directly
  // cross-env is now in dependencies, so it should always be available
  execSync('cross-env STATIC_EXPORT=true NODE_ENV=production next build', { 
    stdio: 'inherit',
    env: buildEnv
  })
  buildSuccess = true
} catch (error) {
  console.error('\n✗ Build failed')
  buildSuccess = false
}

// Step 5: Always restore API routes and admin pages (even if build failed)
if (!runCommand(`node "${API_HANDLER}" restore`, 'Restoring API routes')) {
  console.error('\n⚠ Warning: Failed to restore API routes automatically')
  console.error('  Please run manually: node scripts/api-routes-handler.js restore')
  console.error('  Or restore from git: git checkout HEAD -- app/api')
  process.exit(1)
}

// Restore admin pages
if (fs.existsSync(adminBackup)) {
  try {
    if (fs.existsSync(adminDir)) {
      fs.rmSync(adminDir, { recursive: true, force: true })
    }
    fs.renameSync(adminBackup, adminDir)
    console.log('✓ Restored admin directory')
  } catch (error) {
    console.error('⚠ Warning: Failed to restore admin directory:', error.message)
    console.error('  Please restore manually from git: git checkout HEAD -- app/admin')
  }
}

// Exit with build result
process.exit(buildSuccess ? 0 : 1)

