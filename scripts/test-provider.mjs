import { loadLocalEnv } from '../lib/config.mjs';
import { withTestFile, runProviderWorker } from '../lib/live-test.mjs';
import { ValidationError } from '../lib/media.mjs';

loadLocalEnv();
const [provider, path] = process.argv.slice(2);
if (!['rd','groq'].includes(provider) || !path || process.argv.length !== 4) {
  console.error('Usage: npm run scan:rd -- "C:\\path\\recording.wav"');
  console.error('   or: npm run transcribe:groq -- "C:\\path\\recording.wav"');
  process.exitCode = 1;
} else {
  const keyName = provider === 'rd' ? 'REALITY_DEFENDER_API_KEY' : 'GROQ_API_KEY';
  if (!process.env[keyName]?.trim()) {
    console.error(JSON.stringify({ provider, outcome: 'not_run', error: 'missing_key', configuration: '.env', keyName }));
    process.exitCode = 1;
  } else {
    try {
      const result = await withTestFile(path, provider, upload => runProviderWorker(provider, upload));
      console.log(JSON.stringify(result, null, 2));
      if (result.outcome === 'failed' || result.error) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ provider, outcome: 'not_run',
        error: error instanceof ValidationError ? 'invalid_media' : ['ENOENT','EACCES','audio_required','not_a_file'].includes(error.code || error.message) ? (error.code || error.message) : 'file_error' }));
      process.exitCode = 1;
    }
  }
}
