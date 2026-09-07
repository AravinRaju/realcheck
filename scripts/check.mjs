import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildPanel } from '../extension/build.mjs';
await buildPanel(undefined, process.env.REALCHECK_EXTENSION_BACKEND || 'http://127.0.0.1:3001');
const folders = ['lib', 'public', 'scripts', 'tests', 'extension', 'extension/tests', 'extension/panel', 'extension/lib'];
const sources = ['server.mjs'];
for (const folder of folders) {
  for (const name of await readdir(folder)) if (/\.(mjs|js)$/.test(name)) sources.push(join(folder, name));
}
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const html = await readFile('public/index.html', 'utf8');
const app = await readFile('public/app.js', 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) if (!ids.has(id)) throw new Error('Missing HTML element: ' + id);
for (const file of ['public/app.js', 'public/index.html', 'public/styles.css']) {
  const text = await readFile(file, 'utf8');
  if (/\b(?:rd_[0-9a-f]{16}|gsk_[A-Za-z0-9]{12})/.test(text)) throw new Error('Credential-shaped text in browser asset');
}
console.log('Syntax and frontend wiring verified for ' + sources.length + ' source files.');
