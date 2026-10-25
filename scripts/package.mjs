#!/usr/bin/env node
// Zip the extension folder for a release (never includes config.local.json).
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(`${root}extension/manifest.json`, 'utf8'));
const out = `${root}dist/trove-v${version}.zip`;
mkdirSync(`${root}dist`, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', 'config.local.json', '-x', '*.DS_Store'], { cwd: `${root}extension`, stdio: 'inherit' });
console.log(out);
