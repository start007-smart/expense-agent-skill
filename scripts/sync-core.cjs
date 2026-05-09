#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const SOURCE_DIR = path.resolve(SKILL_DIR, '..', 'hesi-openapi-core');
const TARGET_DIR = path.join(SKILL_DIR, 'vendor', 'hesi-openapi-core');
const INCLUDE = ['client.cjs', 'errors.cjs', 'expense-docs.cjs', 'index.cjs', 'safety.cjs', 'meta.json', 'package.json', 'README.md'];

function copyFile(name) {
  fs.copyFileSync(path.join(SOURCE_DIR, name), path.join(TARGET_DIR, name));
}

function main() {
  if (!fs.existsSync(path.join(SOURCE_DIR, 'index.cjs'))) {
    throw new Error(`Missing core source: ${SOURCE_DIR}`);
  }

  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  for (const name of INCLUDE) copyFile(name);

  const meta = JSON.parse(fs.readFileSync(path.join(TARGET_DIR, 'meta.json'), 'utf8'));
  process.stdout.write(`Synced hesi-openapi-core ${meta.version} to ${TARGET_DIR}\n`);
}

main();
