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

console.log(`\n🔍 Deep Verification of ${files.length} v1 API routes...\n`);

let issues = [];
let verified = [];

files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/');
  
  const routeIssues = [];
  
  // Check 1: Has withVersioning import
  if (content.includes('withVersioning') && !/import.*withVersioning.*from.*['"]@\/lib\/api-version-wrapper['"]/.test(content)) {
    routeIssues.push('❌ Missing or incorrect withVersioning import');
  }
  
  // Check 2: Has getRequestPath import if used
  if (content.includes('getRequestPath') && !/import.*getRequestPath.*from.*['"]@\/lib\/api-versioning['"]/.test(content)) {
    routeIssues.push('❌ Missing or incorrect getRequestPath import');
  }
  
  // Check 3: All handlers use withVersioning
  const handlerMatches = content.match(/export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)\s*[=(]/g);
  if (handlerMatches) {
    handlerMatches.forEach(match => {
      const method = match.match(/(GET|POST|PATCH|DELETE|PUT)/)?.[0];
      // Check if this handler is wrapped with withVersioning
      const handlerIndex = content.indexOf(match);
      const beforeHandler = content.substring(Math.max(0, handlerIndex - 200), handlerIndex);
      const afterHandler = content.substring(handlerIndex, handlerIndex + 500);
      
      if (!beforeHandler.includes('withVersioning') && !afterHandler.includes('withVersioning')) {
        routeIssues.push(`❌ Handler ${method} is not wrapped with withVersioning`);
      }
    });
  }
  
  // Check 4: Proper closing braces for withVersioning
  const withVersioningMatches = [...content.matchAll(/withVersioning\s*\(/g)];
  withVersioningMatches.forEach((match, idx) => {
    const startIndex = match.index;
    const afterMatch = content.substring(startIndex);
    
    // Count opening and closing braces/parens
    let depth = 0;
    let parenDepth = 0;
    let foundArrow = false;
    let foundFunction = false;
    
    for (let i = 0; i < Math.min(2000, afterMatch.length); i++) {
      const char = afterMatch[i];
      const nextChar = afterMatch[i + 1];
      
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      if (char === '{') depth++;
      if (char === '}') depth--;
      
      if (char === '=' && nextChar === '>') {
        foundArrow = true;
      }
      if (char === 'f' && afterMatch.substring(i, i + 8) === 'function') {
        foundFunction = true;
      }
      
      // Check if we've closed the withVersioning call
      if (parenDepth === 0 && depth === 0 && i > 100) {
        const closing = afterMatch.substring(Math.max(0, i - 10), i + 1);
        if (!closing.includes('})') && !closing.includes('})')) {
          routeIssues.push(`⚠️  Handler ${idx + 1} may have incorrect closing braces`);
        }
        break;
      }
    }
  });
  
  // Check 5: Handlers that need request parameter but don't have it
  if (content.includes('getRequestPath') || content.includes('getRequestPath(request)')) {
    const handlers = content.match(/export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning\s*\(async\s*\(([^)]*)\)/g);
    if (handlers) {
      handlers.forEach(handler => {
        const params = handler.match(/async\s*\(([^)]*)\)/)?.[1] || '';
        if (!params.includes('request') && !params.includes('Request')) {
          routeIssues.push('⚠️  Handler uses getRequestPath but missing request parameter');
        }
      });
    }
  }
  
  // Check 6: Dynamic routes should have params
  if (relPath.includes('[') && relPath.includes(']')) {
    const handlers = content.match(/export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning\s*\(async\s*\(([^)]*)\)/g);
    if (handlers) {
      handlers.forEach(handler => {
        const params = handler.match(/async\s*\(([^)]*)\)/)?.[1] || '';
        if (!params.includes('params') && !params.includes('{ params }')) {
          routeIssues.push('⚠️  Dynamic route handler may be missing params parameter');
        }
      });
    }
  }
  
  // Check 7: No re-exports
  if (/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/m.test(content)) {
    routeIssues.push('❌ Contains re-export statement');
  }
  
  if (routeIssues.length > 0) {
    issues.push({
      file: relPath,
      issues: routeIssues
    });
  } else {
    verified.push(relPath);
  }
});

console.log(`✅ Verified: ${verified.length} routes\n`);
if (issues.length > 0) {
  console.log(`❌ Issues found: ${issues.length} routes\n`);
  issues.forEach(({ file, issues: routeIssues }) => {
    console.log(`📄 ${file}`);
    routeIssues.forEach(issue => console.log(`   ${issue}`));
    console.log('');
  });
} else {
  console.log('✅ All routes pass deep verification!\n');
}

// Additional checks
console.log('\n📊 Pattern Analysis:');
const patterns = {
  constWithVersioning: files.filter(f => {
    const c = fs.readFileSync(f, 'utf8');
    return /export\s+const\s+(GET|POST|PATCH|DELETE|PUT)\s*=\s*withVersioning/.test(c);
  }).length,
  usesGetRequestPath: files.filter(f => {
    const c = fs.readFileSync(f, 'utf8');
    return /getRequestPath\(request\)/.test(c);
  }).length,
  hasDynamicParams: files.filter(f => {
    const c = fs.readFileSync(f, 'utf8');
    return /params.*Promise/.test(c);
  }).length,
};

console.log(`   Routes using 'export const METHOD = withVersioning': ${patterns.constWithVersioning}`);
console.log(`   Routes using getRequestPath(request): ${patterns.usesGetRequestPath}`);
console.log(`   Routes with dynamic params: ${patterns.hasDynamicParams}`);

process.exit(issues.length > 0 ? 1 : 0);

