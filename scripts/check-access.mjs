const endpoints = {
  GitHub: 'https://github.com/AravinRaju/realcheck.git/info/refs?service=git-upload-pack',
  npm: 'https://registry.npmjs.org/@realitydefender%2frealitydefender',
  'Reality Defender': 'https://api.prd.realitydefender.xyz/api/files/aws-presigned',
  Groq: 'https://api.groq.com/openai/v1/audio/transcriptions',
};
await Promise.all(Object.entries(endpoints).map(async ([service, url]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    console.log(JSON.stringify({ service, url, reachable: true, httpStatus: response.status }));
    await response.body?.cancel();
  } catch (error) {
    console.log(JSON.stringify({ service, url, reachable: false, error: error.message, code: error.cause?.code || error.name }));
  }
}));
// A 401/403/405 proves transport reachability, not credential validity.
