import { loadLocalEnv } from '../lib/config.mjs';
loadLocalEnv();
let missing = false;
for (const name of ['REALITY_DEFENDER_API_KEY', 'GROQ_API_KEY']) {
  const configured = !!process.env[name]?.trim();
  console.log(name + ': ' + (configured ? 'configured' : 'missing'));
  if (!configured) missing = true;
}
if (missing) process.exitCode = 1;
