#!/usr/bin/env node

/**
 * V1 API Route Migration Script
 * 
 * This script migrates v1 API routes from re-export pattern to fully implemented routes.
 * It reads legacy routes and creates v1 versions with proper versioning support.
 * 
 * Usage: node scripts/migrate-v1-routes.js [route-path]
 *   - If route-path is provided, migrates only that route
 *   - If no route-path, migrates all remaining routes
 */

const fs = require('fs');
const path = require('path');

// Route mappings: v1 route -> legacy route
const ROUTE_MAPPINGS = [
  // Critical routes
  { v1: 'app/api/v1/admin/bookings/[id]/route.ts', legacy: 'app/api/admin/bookings/[id]/route.ts' },
  { v1: 'app/api/v1/booking/response/[token]/route.ts', legacy: 'app/api/booking/response/[token]/route.ts' },
  
  // Admin routes
  { v1: 'app/api/v1/admin/settings/route.ts', legacy: 'app/api/admin/settings/route.ts' },
  { v1: 'app/api/v1/admin/events/route.ts', legacy: 'app/api/admin/events/route.ts' },
  { v1: 'app/api/v1/admin/events/[id]/route.ts', legacy: 'app/api/admin/events/[id]/route.ts' },
  { v1: 'app/api/v1/admin/events/[id]/images/route.ts', legacy: 'app/api/admin/events/[id]/images/route.ts' },
  { v1: 'app/api/v1/admin/events/[id]/images/[imageId]/route.ts', legacy: 'app/api/admin/events/[id]/images/[imageId]/route.ts' },
  { v1: 'app/api/v1/admin/images/route.ts', legacy: 'app/api/admin/images/route.ts' },
  { v1: 'app/api/v1/admin/images/[id]/route.ts', legacy: 'app/api/admin/images/[id]/route.ts' },
  { v1: 'app/api/v1/admin/images/toggle-ai-selection/route.ts', legacy: 'app/api/admin/images/toggle-ai-selection/route.ts' },
  { v1: 'app/api/v1/admin/email-queue/route.ts', legacy: 'app/api/admin/email-queue/route.ts' },
  { v1: 'app/api/v1/admin/email-queue/[id]/route.ts', legacy: 'app/api/admin/email-queue/[id]/route.ts' },
  
  // Utility routes
  { v1: 'app/api/v1/admin/init-db/route.ts', legacy: 'app/api/admin/init-db/route.ts' },
  { v1: 'app/api/v1/admin/migrate-images/route.ts', legacy: 'app/api/admin/migrate-images/route.ts' },
  { v1: 'app/api/v1/admin/cleanup-orphaned-images/route.ts', legacy: 'app/api/admin/cleanup-orphaned-images/route.ts' },
  { v1: 'app/api/v1/admin/cleanup-orphaned-deposits/route.ts', legacy: 'app/api/admin/cleanup-orphaned-deposits/route.ts' },
  
  // Public routes
  { v1: 'app/api/v1/verify-recaptcha/route.ts', legacy: 'app/api/verify-recaptcha/route.ts' },
  { v1: 'app/api/v1/deposit/[token]/image/route.ts', legacy: 'app/api/deposit/[token]/image/route.ts' },
  { v1: 'app/api/v1/images/optimize/route.ts', legacy: 'app/api/images/optimize/route.ts' },
  { v1: 'app/api/v1/ai-space/route.ts', legacy: 'app/api/ai-space/route.ts' },
  
  // Cron routes
  { v1: 'app/api/v1/cron/auto-update-bookings/route.ts', legacy: 'app/api/cron/auto-update-bookings/route.ts' },
  { v1: 'app/api/v1/cron/email-queue/route.ts', legacy: 'app/api/cron/email-queue/route.ts' },
  { v1: 'app/api/v1/cron/job-queue/route.ts', legacy: 'app/api/cron/job-queue/route.ts' },
  { v1: 'app/api/v1/cron/reminders/route.ts', legacy: 'app/api/cron/reminders/route.ts' },
  { v1: 'app/api/v1/cron/daily-digest/route.ts', legacy: 'app/api/cron/daily-digest/route.ts' },
  { v1: 'app/api/v1/cron/weekly-digest/route.ts', legacy: 'app/api/cron/weekly-digest/route.ts' },
  { v1: 'app/api/v1/cron/cleanup-orphaned-deposits/route.ts', legacy: 'app/api/cron/cleanup-orphaned-deposits/route.ts' },
];

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

function writeFile(filePath, content) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error.message);
    return false;
  }
}

function checkIfReExport(filePath) {
  const content = readFile(filePath);
  if (!content) return false;
  
  // Check if file contains re-export pattern (multiline match)
  const reExportPattern = /export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/;
  return reExportPattern.test(content) || /\/\/\s*Re-export/i.test(content);
}

function extractExports(content) {
  const exports = [];
  
  // Match export async function GET/POST/PATCH/DELETE
  const functionExports = content.match(/export\s+async\s+function\s+(GET|POST|PATCH|DELETE|PUT)\s*\(/g);
  if (functionExports) {
    functionExports.forEach(match => {
      const method = match.match(/(GET|POST|PATCH|DELETE|PUT)/)[0];
      exports.push(method);
    });
  }
  
  // Match export const GET/POST/PATCH/DELETE
  const constExports = content.match(/export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=/g);
  if (constExports) {
    constExports.forEach(match => {
      const method = match.match(/(GET|POST|PATCH|DELETE|PUT)/)[0];
      exports.push(method);
    });
  }
  
  return [...new Set(exports)]; // Remove duplicates
}

function migrateRoute(v1Path, legacyPath) {
  console.log(`\nMigrating: ${v1Path}`);
  
  // Check if v1 route exists and is re-export
  if (!fs.existsSync(v1Path)) {
    console.log(`  ⚠️  V1 route file doesn't exist: ${v1Path}`);
    return false;
  }
  
  if (!checkIfReExport(v1Path)) {
    console.log(`  ✅ Already migrated (no re-export found)`);
    return true;
  }
  
  // Read legacy route
  const legacyContent = readFile(legacyPath);
  if (!legacyContent) {
    console.log(`  ❌ Could not read legacy route: ${legacyPath}`);
    return false;
  }
  
  // Extract exports
  const exports = extractExports(legacyContent);
  if (exports.length === 0) {
    console.log(`  ⚠️  No exports found in legacy route`);
    return false;
  }
  
  console.log(`  Found exports: ${exports.join(', ')}`);
  
  // Read v1 route to get header comment
  const v1Content = readFile(v1Path);
  let headerComment = '';
  if (v1Content) {
    // Extract header comment (everything before first import or export)
    const headerMatch = v1Content.match(/^(\/\*\*[\s\S]*?\*\/)/);
    if (headerMatch) {
      headerComment = headerMatch[1];
      // Update header to remove "Maintains backward compatibility" line
      headerComment = headerComment
        .replace(/Maintains backward compatibility with.*\n/g, '')
        .replace(/\n\s*\n\s*\n/g, '\n\n');
    }
  }
  
  // If no header, create one
  if (!headerComment) {
    const routeName = path.basename(path.dirname(v1Path));
    headerComment = `/**
 * ${routeName.charAt(0).toUpperCase() + routeName.slice(1)} API v1
 * 
 * Versioned endpoint
 */`;
  }
  
  // Transform legacy content
  let migratedContent = legacyContent;
  
  // 1. Add versioning imports if not present
  if (!migratedContent.includes('withVersioning')) {
    const importMatch = migratedContent.match(/^import.*from.*["']@\/lib\/api-response["']/m);
    if (importMatch) {
      migratedContent = migratedContent.replace(
        /^import.*from.*["']@\/lib\/api-response["']/m,
        `$&\nimport { withVersioning } from "@/lib/api-version-wrapper"`
      );
    } else {
      // Add after first import
      const firstImport = migratedContent.match(/^import.*$/m);
      if (firstImport) {
        migratedContent = migratedContent.replace(
          /^(import.*)$/m,
          `$1\nimport { withVersioning } from "@/lib/api-version-wrapper"`
        );
      }
    }
  }
  
  // 2. Ensure getRequestPath is imported
  if (!migratedContent.includes('getRequestPath')) {
    if (migratedContent.includes('from "@/lib/api-versioning"')) {
      migratedContent = migratedContent.replace(
        /from ["']@\/lib\/api-versioning["']/,
        'from "@/lib/api-versioning"'
      );
    } else {
      const importMatch = migratedContent.match(/^import.*from.*["']@\/lib\/api-response["']/m);
      if (importMatch) {
        migratedContent = migratedContent.replace(
          /^import.*from.*["']@\/lib\/api-response["']/m,
          `$&\nimport { getRequestPath } from "@/lib/api-versioning"`
        );
      }
    }
  }
  
  // 3. Wrap each export with withVersioning
  exports.forEach(method => {
    // Pattern 1: export async function METHOD(request, context?)
    const asyncFunctionPattern = new RegExp(
      `export\\s+async\\s+function\\s+${method}\\s*\\(([^)]*)\\)\\s*\\{`,
      'g'
    );
    
    if (asyncFunctionPattern.test(migratedContent)) {
      migratedContent = migratedContent.replace(
        new RegExp(
          `(export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{)`,
          'g'
        ),
        `export const ${method} = withVersioning(async ($1`
      );
      
      // Find the closing brace for this function and add closing paren
      // This is a simplified approach - for complex functions, manual review may be needed
      migratedContent = migratedContent.replace(
        new RegExp(`(}, \\{ endpoint: getRequestPath\\(request\\) \\})`, 'g'),
        `$1})`
      );
    } else {
      // Pattern 2: export const METHOD = async (request, context?) =>
      const constPattern = new RegExp(
        `export\\s+const\\s+${method}\\s*=\\s*async\\s*\\(([^)]*)\\)`,
        'g'
      );
      
      if (constPattern.test(migratedContent)) {
        migratedContent = migratedContent.replace(
          new RegExp(`export\\s+const\\s+${method}\\s*=\\s*async`, 'g'),
          `export const ${method} = withVersioning(async`
        );
        
        // Ensure closing paren for withVersioning
        migratedContent = migratedContent.replace(
          new RegExp(`(}, \\{ endpoint: getRequestPath\\(request\\) \\})`, 'g'),
          `$1})`
        );
      }
    }
  });
  
  // 4. Replace hardcoded endpoint paths with getRequestPath(request)
  migratedContent = migratedContent.replace(
    /createRequestLogger\([^,]+,\s*['"`][^'"`]+['"`]\)/g,
    (match) => {
      if (match.includes('getRequestPath')) return match;
      return match.replace(/['"`][^'"`]+['"`]/, 'getRequestPath(request)');
    }
  );
  
  migratedContent = migratedContent.replace(
    /endpoint:\s*['"`][^'"`]+['"`]/g,
    'endpoint: getRequestPath(request)'
  );
  
  // 5. Build final content
  const finalContent = `${headerComment}

${migratedContent}`;
  
  // Write migrated content
  if (writeFile(v1Path, finalContent)) {
    console.log(`  ✅ Successfully migrated`);
    return true;
  } else {
    console.log(`  ❌ Failed to write migrated content`);
    return false;
  }
}

// Main execution
const targetRoute = process.argv[2];

if (targetRoute) {
  // Migrate single route
  const mapping = ROUTE_MAPPINGS.find(m => m.v1.includes(targetRoute));
  if (mapping) {
    migrateRoute(mapping.v1, mapping.legacy);
  } else {
    console.error(`Route not found in mappings: ${targetRoute}`);
    process.exit(1);
  }
} else {
  // Migrate all routes
  console.log('Starting migration of all v1 routes...\n');
  
  let successCount = 0;
  let failCount = 0;
  
  ROUTE_MAPPINGS.forEach(mapping => {
    if (migrateRoute(mapping.v1, mapping.legacy)) {
      successCount++;
    } else {
      failCount++;
    }
  });
  
  console.log(`\n\nMigration complete:`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  📊 Total: ${ROUTE_MAPPINGS.length}`);
}

