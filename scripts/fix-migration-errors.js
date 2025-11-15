#!/usr/bin/env node

/**
 * Fix migration script errors
 * Fixes malformed export statements created by the migration script
 */

const fs = require('fs');
const path = require('path');

function findTsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findTsFiles(filePath, fileList);
    } else if (file.endsWith('.ts')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  
  // Fix pattern: export const METHOD = withVersioning(async (export async function METHOD(params) {
  // Should be: export const METHOD = withVersioning(async (params) => {
  content = content.replace(
    /export const (GET|POST|PATCH|DELETE|PUT) = withVersioning\(async \(export async function \1\(([^)]*)\) \{/g,
    'export const $1 = withVersioning(async ($2) => {'
  );
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

// Main execution
const v1Dir = path.join(process.cwd(), 'app', 'api', 'v1');
const files = findTsFiles(v1Dir);

let fixedCount = 0;
files.forEach(file => {
  if (fixFile(file)) {
    fixedCount++;
    console.log(`Fixed: ${file}`);
  }
});

console.log(`\nTotal files fixed: ${fixedCount}`);

