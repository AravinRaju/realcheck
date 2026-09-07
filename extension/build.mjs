import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { validateBackendOrigin } from './client.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const extensionRoot = fileURLToPath(new URL('.', import.meta.url));

export async function buildPanel(output = extensionRoot, origin = 'http://127.0.0.1:3001') {
  validateBackendOrigin(origin);
  await mkdir(output, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.template.json'), 'utf8'));
  manifest.host_permissions = [new URL(origin).protocol + '//' + new URL(origin).hostname + '/*'];
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(/connect-src [^;]+;/, 'connect-src ' + origin + ';');
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Explicit source allowlist: never copy .env, uploads, node_modules or keys.
  const sources = {
    'panel/app.js': 'public/app.js',
    'panel/styles.css': 'public/styles.css',
    'panel/review.mjs': 'public/review.mjs',
    'lib/rules.mjs': 'lib/rules.mjs',
  };
  for (const [target, source] of Object.entries(sources)) {
    let content = await readFile(join(root, source), 'utf8');
    if (target === 'panel/app.js') content = "import { createPanelFetch } from '../client.mjs';\nconst fetch = createPanelFetch(undefined, " + JSON.stringify(origin) + ");\n" + content;
    await mkdir(resolve(output, target, '..'), { recursive: true });
    await writeFile(join(output, target), content);
  }
  let html = await readFile(join(root, 'public/index.html'), 'utf8');
  if (!html.includes('src="/app.js"') || !html.includes('href="/styles.css"')) throw new Error('Shared website asset layout changed.');
  html = html.replace('src="/app.js"', 'src="./app.js"')
    .replace('href="/styles.css"', 'href="./styles.css"')
    .replace('class="brand" href="/"', 'class="brand" href="./index.html"')
    .replace('</head>', '<link rel="stylesheet" href="../sidepanel.css">\n<script type="module" src="../panel-shell.mjs"></script>\n</head>')
    .replace('<main>', `<main>
    <aside class="extension-notice" aria-label="Backend connection">
      <details><summary>Connection settings</summary><p>Backend: ${origin}. Only files you choose are checked, after you click Check this file.</p><p>Start your RealCheck backend with this public extension ID in REALCHECK_EXTENSION_ID:</p><code id="extension-id"></code><p>Provider keys belong only in the server environment. This panel cannot read the current webpage.</p></details>
    </aside>`);
  await writeFile(join(output, 'panel/index.html'), html);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPanel(extensionRoot, process.env.REALCHECK_EXTENSION_BACKEND || 'http://127.0.0.1:3001');
  console.log('Built side panel from shared website sources. No provider calls or private files copied.');
}
