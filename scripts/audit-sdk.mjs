import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
const require = createRequire(import.meta.url);
let entry;
try { entry = require.resolve('@realitydefender/realitydefender'); }
catch {
  console.log('Reality Defender SDK is not installed. No installed response types can be verified. Live detection mapping is disabled.');
  process.exitCode = 1;
}
if (entry) {
  let directory = dirname(entry), metadata;
  while (directory !== parse(directory).root) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (candidate.name === '@realitydefender/realitydefender') { metadata = candidate; break; }
    } catch {}
    directory = dirname(directory);
  }
  if (!metadata) throw new Error('SDK package metadata unavailable.');
  console.log('Installed SDK: ' + metadata.name + '@' + metadata.version);
  async function inspect(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue;
      const target = join(path, item.name);
      if (item.isDirectory()) await inspect(target);
      else if (/\.d\.(?:ts|mts|cts)$/.test(item.name)) {
        const contents = await readFile(target, 'utf8');
        if (/DetectionResult|DetectionStatus|UploadResponse|GetResultOptions/.test(contents)) {
          console.log('\nTYPE FILE: ' + target + '\n' + contents);
        }
      }
    }
  }
  await inspect(directory);
  console.log('SDK declarations inspected locally. Live verification is separate: run the one-off commands in an authorized environment and review their redacted responses.');
}
