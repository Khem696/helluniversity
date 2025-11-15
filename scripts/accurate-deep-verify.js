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

function verifyHandler(content, handlerStart, method) {
  const issues = [];
  
  // Extract the handler function
  const handlerEnd = content.indexOf('export const', handlerStart + 1);
  const handlerContent = handlerEnd > 0 
    ? content.substring(handlerStart, handlerEnd)
    : content.substring(handlerStart);
  
  // Check 1: Has withVersioning wrapper
  if (!handlerContent.includes('withVersioning')) {
    issues.push(`❌ Handler ${method} is NOT wrapped with withVersioning`);
    return issues;
  }
  
  // Check 2: Extract signature
  const signatureMatch = handlerContent.match(/export\s+const\s+\w+\s*=\s*withVersioning\s*\(async\s*\(([^)]*)\)/);
  if (!signatureMatch) {
    issues.push(`❌ Handler ${method} has malformed signature`);
    return issues;
  }
  
  const params = signatureMatch[1].trim();
  const hasRequest = params.includes('request') || params.includes('Request');
  const hasParams = params.includes('params') || params.includes('{ params }');
  
  // Check 3: If uses getRequestPath, must have request
  if (handlerContent.includes('getRequestPath(request)') && !hasRequest) {
    issues.push(`❌ Handler ${method} uses getRequestPath(request) but missing 'request' parameter`);
  }
  
  // Check 4: If uses createRequestLogger with endpoint variable, must have request
  if (handlerContent.includes('createRequestLogger') && handlerContent.includes('endpoint') && !hasRequest) {
    // Check if endpoint is from getRequestPath
    const endpointMatch = handlerContent.match(/const\s+endpoint\s*=\s*getRequestPath\(request\)/);
    if (endpointMatch && !hasRequest) {
      issues.push(`❌ Handler ${method} uses getRequestPath(request) but missing 'request' parameter`);
    }
  }
  
  // Check 5: Verify closing braces
  // Count opening withVersioning(
  const withVersioningOpen = (handlerContent.match(/withVersioning\s*\(/g) || []).length;
  
  // Count closing pattern: }, { endpoint: getRequestPath(request) })
  const properClosing = (handlerContent.match(/\},\s*\{\s*endpoint:\s*getRequestPath\(request\)\s*\}\s*\}\)/g) || []).length;
  
  if (withVersioningOpen > 0 && properClosing === 0) {
    // Try alternative closing patterns
    const altClosing1 = handlerContent.match(/\}\s*,\s*\{\s*endpoint:\s*getRequestPath\(request\)\s*\}\s*\}\)/g);
    if (!altClosing1 || altClosing1.length === 0) {
      // Check if it ends with })
      const endsWithClosing = handlerContent.trim().endsWith('})');
      if (!endsWithClosing) {
        issues.push(`⚠️  Handler ${method} may have incorrect closing braces`);
      }
    }
  }
  
  return issues;
}

const v1Dir = path.join(process.cwd(), 'app', 'api', 'v1');
const files = findRouteFiles(v1Dir).sort();

console.log(`\n🔬 ACCURATE DEEP VERIFICATION of ${files.length} v1 API routes...\n`);

let allIssues = [];
let verified = [];

files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/');
  
  const issues = [];
  const handlers = [];
  
  // Find all handlers
  const handlerPattern = /export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning/g;
  let match;
  while ((match = handlerPattern.exec(content)) !== null) {
    const method = match[1];
    const handlerStart = match.index;
    handlers.push({ method, start: handlerStart });
  }
  
  // Verify each handler
  handlers.forEach(({ method, start }) => {
    const handlerIssues = verifyHandler(content, start, method);
    issues.push(...handlerIssues);
  });
  
  // Check for re-exports
  if (/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/m.test(content)) {
    issues.push('❌ Contains re-export statement');
  }
  
  // Check imports
  if (content.includes('withVersioning')) {
    const importMatch = content.match(/import\s+.*withVersioning.*from\s+['"]@\/lib\/api-version-wrapper['"]/);
    if (!importMatch) {
      issues.push('❌ Missing or incorrect withVersioning import');
    }
  }
  
  if (content.includes('getRequestPath')) {
    const importMatch = content.match(/import\s+.*getRequestPath.*from\s+['"]@\/lib\/api-versioning['"]/);
    if (!importMatch) {
      issues.push('❌ Missing or incorrect getRequestPath import');
    }
  }
  
  // Check for hardcoded paths
  const hardcodedLogger = /createRequestLogger\s*\([^,]+,\s*['"`]\/api\/[^'"`]+['"`]\)/;
  if (hardcodedLogger.test(content)) {
    // But allow if getRequestPath is also used
    if (!content.includes('getRequestPath(request)')) {
      issues.push('⚠️  Has hardcoded endpoint path in createRequestLogger');
    }
  }
  
  const hardcodedEndpoint = /\{\s*endpoint:\s*['"`]\/api\/[^'"`]+['"`]\s*\}/;
  if (hardcodedEndpoint.test(content)) {
    if (!content.includes('getRequestPath(request)')) {
      issues.push('⚠️  Has hardcoded endpoint path in withErrorHandling');
    }
  }
  
  // Check for console.log (should use logger)
  if (content.includes('console.log') || content.includes('console.error')) {
    // This is just a warning, not critical
    // Don't add to issues unless it's excessive
  }
  
  if (issues.length > 0) {
    allIssues.push({
      file: relPath,
      issues: issues,
      handlerCount: handlers.length
    });
  } else {
    verified.push(relPath);
  }
});

// Print results
console.log(`✅ Verified without issues: ${verified.length} routes\n`);

if (allIssues.length > 0) {
  console.log(`❌ Issues found: ${allIssues.length} routes\n`);
  allIssues.forEach(({ file, issues, handlerCount }) => {
    console.log(`📄 ${file} (${handlerCount} handler${handlerCount > 1 ? 's' : ''})`);
    issues.forEach(issue => console.log(`   ${issue}`));
    console.log('');
  });
} else {
  console.log('✅ All routes pass accurate deep verification!\n');
}

// Statistics
console.log('\n📊 Statistics:');
const stats = {
  total: files.length,
  verified: verified.length,
  withIssues: allIssues.length,
  totalHandlers: files.reduce((sum, f) => {
    const c = fs.readFileSync(f, 'utf8');
    const matches = c.match(/export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning/g);
    return sum + (matches ? matches.length : 0);
  }, 0),
};

console.log(`   Total routes: ${stats.total}`);
console.log(`   Verified: ${stats.verified}`);
console.log(`   With issues: ${stats.withIssues}`);
console.log(`   Total handlers: ${stats.totalHandlers}`);

process.exit(allIssues.length > 0 ? 1 : 0);


