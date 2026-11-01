// Bundles the server (and the shared workspace package, ws and qrcode) into apps/server/dist/server.mjs, so a
// release needs no node_modules. The version / repository of the root package.json are baked in.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // optional native speed-ups of ws; ws falls back to plain JS when they are missing
  external: ['bufferutil', 'utf-8-validate'],
  define: { __CRIM_VERSION__: JSON.stringify(pkg.version), __CRIM_REPO__: JSON.stringify(repo) },
  sourcemap: true,
  logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
