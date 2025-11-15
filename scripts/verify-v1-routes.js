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

console.log(`\n🔍 Verifying ${files.length} v1 API routes...\n`);

let issues = [];
let verified = [];

files.forEach((file, index) => {
  const content = fs.readFileSync(file, 'utf8');
  const relPath = file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/');
  
  const checks = {
    hasReExport: /^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/m.test(content),
    hasWithVersioning: /withVersioning/.test(content),
    hasGetRequestPath: /getRequestPath\(request\)/.test(content),
    hasHardcodedPath: /createRequestLogger\([^,]+,\s*['"`]\/api\/[^'"`]+['"`]\)/.test(content) && !content.includes('getRequestPath(request)'),
    missingVersioning: /export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)\s*[=(]/.test(content) && !/withVersioning/.test(content),
    missingImportVersioning: /withVersioning/.test(content) && !/import.*withVersioning.*from/.test(content),
    missingImportGetRequestPath: /getRequestPath/.test(content) && !/import.*getRequestPath.*from/.test(content),
    incorrectClosing: /withVersioning\(async\s*\([^)]*\)\s*=>\s*\{/.test(content) && !/\}\)\s*\}\)/.test(content.split('withVersioning')[1]),
  };
  
  const routeIssues = [];
  
  if (checks.hasReExport) {
    routeIssues.push('❌ Has re-export statement');
  }
  
  if (checks.missingVersioning) {
    routeIssues.push('❌ Missing withVersioning wrapper');
  }
  
  if (checks.missingImportVersioning) {
    routeIssues.push('❌ Uses withVersioning but missing import');
  }
  
  if (checks.missingImportGetRequestPath) {
    routeIssues.push('❌ Uses getRequestPath but missing import');
  }
  
  if (checks.hasHardcodedPath) {
    routeIssues.push('⚠️  Has hardcoded endpoint path (should use getRequestPath)');
  }
  
  if (!checks.hasWithVersioning && !checks.hasReExport) {
    routeIssues.push('⚠️  No withVersioning found (may be missing wrapper)');
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
  console.log('✅ All routes pass verification!\n');
}

// Additional detailed checks
console.log('\n📊 Detailed Statistics:');
const stats = {
  total: files.length,
  withVersioning: files.filter(f => fs.readFileSync(f, 'utf8').includes('withVersioning')).length,
  withGetRequestPath: files.filter(f => fs.readFileSync(f, 'utf8').includes('getRequestPath')).length,
  handlers: files.reduce((sum, f) => {
    const content = fs.readFileSync(f, 'utf8');
    const matches = content.match(/export\s+(const|async function)\s+(GET|POST|PATCH|DELETE|PUT)/g);
    return sum + (matches ? matches.length : 0);
  }, 0),
};

console.log(`   Total route files: ${stats.total}`);
console.log(`   Routes with withVersioning: ${stats.withVersioning}`);
console.log(`   Routes with getRequestPath: ${stats.withGetRequestPath}`);
console.log(`   Total handlers: ${stats.handlers}`);

process.exit(issues.length > 0 ? 1 : 0);

