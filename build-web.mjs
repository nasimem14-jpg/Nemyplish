// Genera la web a partir de web/src.html:
//   dist/index.html     documento completo para subir a cualquier hosting estático
//   dist/artifact.html  fragmento para publicarlo como artifact (modo demo dentro de Claude)
// Uso: SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... npm run build:web
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'web/src.html'), 'utf8');
const prompts = readFileSync(join(root, 'supabase/functions/_shared/prompts.js'), 'utf8').replace(/^export /gm, '');
const inlined = 'var Prompts = (function () {\n' + prompts + '\nreturn { sanitize: sanitize, build: build, extractJson: extractJson };\n})();';

function fill(html, url, key) {
  return html
    .replace('/*__PROMPTS__*/', () => inlined)
    .replace('__SUPABASE_URL__', () => url)
    .replace('__SUPABASE_ANON_KEY__', () => key);
}

mkdirSync(join(root, 'dist'), { recursive: true });

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
const full = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  fill(src.slice(0, src.indexOf('<main id="app">')), url, key) +
  '</head>\n<body>\n' + fill(src.slice(src.indexOf('<main id="app">')), url, key) + '\n</body>\n</html>\n';
writeFileSync(join(root, 'dist/index.html'), full);
writeFileSync(join(root, 'dist/artifact.html'), fill(src, '', ''));
console.log('dist/index.html' + (url && key ? ' (con tu proyecto de Supabase)' : ' (sin configurar: modo demo/setup)') + ' y dist/artifact.html generados');
