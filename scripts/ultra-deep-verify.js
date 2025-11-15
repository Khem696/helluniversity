const fs = require('fs');
const path = require('path');

function findRouteFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      findRouteFiles(filePath, fileList);
    } else if (file === 'route.ts') {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const v1Dir = path.join(process.cwd(), 'app', 'api', 'v1');
const files = findRouteFiles(v1Dir).sort();

console.log(`\n🔬 ULTRA-DEEP VERIFICATION of ${files.length} v1 API routes...\n`);

let allIssues = [];
let routeDetails = [];

files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/');
  const lines = content.split('\n');
  
  const issues = [];
  const details = {
    file: relPath,
    handlers: [],
    hasDynamicParams: relPath.includes('[') && relPath.includes(']'),
    lineCount: lines.length,
  };
  
  // Check 1: Extract all handlers
  const handlerPattern = /export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)\s*[=(]/g;
  let handlerMatch;
  while ((handlerMatch = handlerPattern.exec(content)) !== null) {
    const method = handlerMatch[2];
    const startPos = handlerMatch.index;
    const handlerStart = content.substring(startPos, startPos + 500);
    
    // Extract handler signature
    const signatureMatch = handlerStart.match(/export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning\s*\(async\s*\(([^)]*)\)/);
    const params = signatureMatch ? signatureMatch[3] : '';
    
    const handlerInfo = {
      method,
      hasRequest: params.includes('request') || params.includes('Request'),
      hasParams: params.includes('params') || params.includes('{ params }'),
      params: params.trim(),
    };
    
    details.handlers.push(handlerInfo);
    
    // Check if handler is wrapped with withVersioning
    if (!handlerStart.includes('withVersioning')) {
      issues.push(`❌ Handler ${method} is NOT wrapped with withVersioning`);
    }
    
    // Check if handler needs request but doesn't have it
    const usesGetRequestPath = content.substring(startPos).includes('getRequestPath(request)');
    const usesCreateRequestLogger = content.substring(startPos).includes('createRequestLogger');
    if ((usesGetRequestPath || usesCreateRequestLogger) && !handlerInfo.hasRequest) {
      issues.push(`❌ Handler ${method} uses getRequestPath/createRequestLogger but missing 'request' parameter`);
    }
    
    // Check if dynamic route handler has params
    if (details.hasDynamicParams && !handlerInfo.hasParams && method !== 'GET') {
      // GET might not need params, but POST/PATCH/DELETE usually do
      if (['POST', 'PATCH', 'DELETE'].includes(method)) {
        issues.push(`⚠️  Handler ${method} in dynamic route may need 'params' parameter`);
      }
    }
  }
  
  // Check 2: Import verification
  const hasWithVersioning = content.includes('withVersioning');
  const hasGetRequestPath = content.includes('getRequestPath');
  
  if (hasWithVersioning) {
    const importMatch = content.match(/import\s+.*withVersioning.*from\s+['"]@\/lib\/api-version-wrapper['"]/);
    if (!importMatch) {
      issues.push('❌ Missing or incorrect withVersioning import');
    }
  }
  
  if (hasGetRequestPath) {
    const importMatch = content.match(/import\s+.*getRequestPath.*from\s+['"]@\/lib\/api-versioning['"]/);
    if (!importMatch) {
      issues.push('❌ Missing or incorrect getRequestPath import');
    }
  }
  
  // Check 3: Re-exports
  if (/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/m.test(content)) {
    issues.push('❌ Contains re-export statement');
  }
  
  // Check 4: Hardcoded paths
  const hardcodedPathPattern = /createRequestLogger\s*\([^,]+,\s*['"`]\/api\/[^'"`]+['"`]\)/;
  if (hardcodedPathPattern.test(content) && !content.includes('getRequestPath(request)')) {
    issues.push('⚠️  Has hardcoded endpoint path in createRequestLogger');
  }
  
  const hardcodedEndpointPattern = /\{ endpoint:\s*['"`]\/api\/[^'"`]+['"`]\s*\}/;
  if (hardcodedEndpointPattern.test(content) && !content.includes('getRequestPath(request)')) {
    issues.push('⚠️  Has hardcoded endpoint path in withErrorHandling');
  }
  
  // Check 5: Closing braces verification
  const withVersioningCount = (content.match(/withVersioning\s*\(/g) || []).length;
  const closingPattern = /\}\)\s*\}\)/g;
  const closingMatches = (content.match(closingPattern) || []).length;
  
  // Count handlers
  const handlerCount = details.handlers.length;
  
  if (withVersioningCount !== closingMatches && handlerCount > 0) {
    // More sophisticated check: count opening and closing
    let openCount = 0;
    let closeCount = 0;
    
    // Count withVersioning openings
    const withVersioningMatches = [...content.matchAll(/withVersioning\s*\(/g)];
    withVersioningMatches.forEach(() => openCount++);
    
    // Count proper closings: }) followed by })
    const properClosings = content.match(/\}\s*,\s*\{\s*endpoint:\s*getRequestPath\(request\)\s*\}\s*\}\)/g);
    if (properClosings) {
      closeCount = properClosings.length;
    }
    
    if (openCount !== closeCount) {
      issues.push(`⚠️  Possible brace mismatch: ${openCount} withVersioning calls, ${closeCount} proper closings`);
    }
  }
  
  // Check 6: TypeScript type issues
  if (content.includes('async () =>') && (content.includes('getRequestPath') || content.includes('createRequestLogger'))) {
    const asyncEmptyPattern = /async\s*\(\s*\)\s*=>/;
    if (asyncEmptyPattern.test(content)) {
      const beforeAsync = content.substring(0, content.search(asyncEmptyPattern));
      const afterAsync = content.substring(content.search(asyncEmptyPattern));
      if (afterAsync.includes('getRequestPath(request)') || afterAsync.includes('createRequestLogger')) {
        issues.push('❌ Handler has empty params () but uses request-dependent functions');
      }
    }
  }
  
  // Check 7: Check for NextRequest vs Request consistency
  const hasNextRequest = content.includes('NextRequest');
  const hasRequest = content.includes(': Request');
  if (hasNextRequest && !hasRequest) {
    // This might be okay if it's in imports, but check handler signatures
    const handlerSignatures = content.match(/async\s*\([^)]*:\s*NextRequest[^)]*\)/g);
    if (handlerSignatures) {
      issues.push('⚠️  Handler uses NextRequest instead of Request (should use Request for withVersioning)');
    }
  }
  
  // Check 8: Verify withErrorHandling endpoint parameter
  const withErrorHandlingMatches = [...content.matchAll(/withErrorHandling\s*\(/g)];
  withErrorHandlingMatches.forEach((match, idx) => {
    const startPos = match.index;
    const afterMatch = content.substring(startPos, startPos + 2000);
    
    // Check if it has endpoint parameter
    if (!afterMatch.includes('endpoint:') && !afterMatch.includes('getRequestPath')) {
      // Find the closing of withErrorHandling
      const closingMatch = afterMatch.match(/\}\s*,\s*\{[^}]*endpoint/);
      if (!closingMatch) {
        issues.push(`⚠️  withErrorHandling call ${idx + 1} may be missing endpoint parameter`);
      }
    }
  });
  
  // Check 9: Check for common mistakes
  if (content.includes('export async function') && !content.includes('export const')) {
    issues.push('⚠️  Uses old "export async function" pattern instead of "export const"');
  }
  
  // Check 10: Verify params handling for dynamic routes
  if (details.hasDynamicParams) {
    details.handlers.forEach(handler => {
      if (handler.hasParams) {
        // Check if params is properly awaited
        const handlerContent = content.substring(content.indexOf(`export const ${handler.method}`));
        if (handlerContent.includes('params') && !handlerContent.includes('await params')) {
          // This might be okay if params is destructured, check for Promise
          if (handlerContent.includes('Promise<') && handlerContent.includes('params')) {
            if (!handlerContent.match(/const\s+\{[^}]*\}\s*=\s*await\s+params/)) {
              issues.push(`⚠️  Handler ${handler.method} may need to await params if it's Promise<{...}>`);
            }
          }
        }
      }
    });
  }
  
  // Check 11: Verify response types
  const hasNextResponse = content.includes('NextResponse');
  if (!hasNextResponse) {
    issues.push('⚠️  Missing NextResponse import (may be needed for type annotations)');
  }
  
  // Check 12: Check for any console.log or debug statements (should use logger)
  if (content.includes('console.log') || content.includes('console.error')) {
    issues.push('⚠️  Contains console.log/error (should use logger instead)');
  }
  
  if (issues.length > 0) {
    allIssues.push({
      file: relPath,
      issues: issues,
      details: details
    });
  } else {
    routeDetails.push(details);
  }
});

// Print results
console.log(`✅ Verified without issues: ${routeDetails.length} routes\n`);

if (allIssues.length > 0) {
  console.log(`❌ Issues found: ${allIssues.length} routes\n`);
  allIssues.forEach(({ file, issues, details }) => {
    console.log(`📄 ${file}`);
    console.log(`   Handlers: ${details.handlers.map(h => h.method).join(', ')}`);
    console.log(`   Dynamic route: ${details.hasDynamicParams ? 'Yes' : 'No'}`);
    console.log(`   Lines: ${details.lineCount}`);
    issues.forEach(issue => console.log(`   ${issue}`));
    console.log('');
  });
} else {
  console.log('✅ All routes pass ultra-deep verification!\n');
}

// Statistics
console.log('\n📊 Comprehensive Statistics:');
const stats = {
  total: files.length,
  withIssues: allIssues.length,
  withoutIssues: routeDetails.length,
  totalHandlers: files.reduce((sum, f) => {
    const c = fs.readFileSync(f, 'utf8');
    const matches = c.match(/export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)/g);
    return sum + (matches ? matches.length : 0);
  }, 0),
  dynamicRoutes: files.filter(f => f.includes('[') && f.includes(']')).length,
  routesWithMultipleHandlers: files.filter(f => {
    const c = fs.readFileSync(f, 'utf8');
    const matches = c.match(/export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)/g);
    return matches && matches.length > 1;
  }).length,
};

console.log(`   Total route files: ${stats.total}`);
console.log(`   Routes without issues: ${stats.withoutIssues}`);
console.log(`   Routes with issues: ${stats.withIssues}`);
console.log(`   Total handlers: ${stats.totalHandlers}`);
console.log(`   Dynamic routes: ${stats.dynamicRoutes}`);
console.log(`   Routes with multiple handlers: ${stats.routesWithMultipleHandlers}`);

// Handler method distribution
const methodCounts = { GET: 0, POST: 0, PATCH: 0, DELETE: 0, PUT: 0 };
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].forEach(method => {
    if (new RegExp(`export\\s+(const|async function)\\s+${method}`).test(c)) {
      methodCounts[method]++;
    }
  });
});

console.log(`\n   Handler method distribution:`);
Object.entries(methodCounts).forEach(([method, count]) => {
  if (count > 0) {
    console.log(`     ${method}: ${count}`);
  }
});

process.exit(allIssues.length > 0 ? 1 : 0);


