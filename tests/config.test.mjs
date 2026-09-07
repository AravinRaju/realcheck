import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('environment loader reads placeholders and preserves existing environment values and file content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'realcheck-env-test-'));
  const path = join(directory, '.env');
  const original = 'REALITY_DEFENDER_API_KEY=local-test-placeholder\nGROQ_API_KEY=\n';
  try {
    await writeFile(path, original);
    const moduleUrl = new URL('../lib/config.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      'import { loadLocalEnv } from ' + JSON.stringify(moduleUrl) + '; loadLocalEnv(process.argv[1]); ' +
      "if (process.env.REALITY_DEFENDER_API_KEY !== 'existing-test-placeholder' || !Object.hasOwn(process.env,'GROQ_API_KEY')) process.exit(1);", path],
      { env: { ...process.env, REALITY_DEFENDER_API_KEY: 'existing-test-placeholder' }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(await readFile(path, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Git ignores actual env and uploads but includes the example', () => {
  const cwd = new URL('../', import.meta.url);
  const ignored = execFileSync('git', ['check-ignore', '.env', '.env.local', 'uploads/example.wav'], { cwd, encoding: 'utf8' });
  assert.match(ignored, /\.env/); assert.match(ignored, /uploads/);
  assert.equal(spawnSync('git', ['check-ignore', '.env.example'], { cwd }).status, 1);
  assert.equal(execFileSync('git', ['ls-files', '.env', '.env.local', 'uploads/'], { cwd, encoding: 'utf8' }).trim(), '');
});
