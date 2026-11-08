// Empaqueta el servidor MCP (src/server) en api/_mcp.mjs, que api/mcp.ts reexporta.
// Por qué: el compilador de @vercel/node transpila cada fichero de api/ por separado y no resuelve el alias `@/`
// ni los imports relativos sin extensión de src/ (ESM de Node). Empaquetado todo el dominio viaja en un único
// fichero; los paquetes de node_modules quedan externos (los traza Vercel).
//   node scripts/bundle-mcp.mjs          reescribe api/_mcp.mjs (se versiona; `pnpm test` comprueba que está al día)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'api', '_mcp.mjs');

export async function bundleMcp() {
  const result = await build({
    entryPoints: [join(root, 'src/server/entry.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    alias: { '@': join(root, 'src') },
    legalComments: 'none',
    banner: { js: '// GENERADO por scripts/bundle-mcp.mjs desde src/server. No se edita a mano.' },
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(out, await bundleMcp());
  console.log('api/_mcp.mjs generado.');
}
