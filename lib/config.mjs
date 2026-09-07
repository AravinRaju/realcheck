import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function loadLocalEnv(path = fileURLToPath(new URL('../.env', import.meta.url))) {
  try { loadEnvFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read the local environment configuration.');
  }
}
