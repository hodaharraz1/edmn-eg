/**
 * Writes the mobile API contracts from the route definitions:
 *   npx tsx scripts/openapi.ts          → openapi/mobile.v1.json, openapi/admin.v1.json
 *   npx tsx scripts/openapi.ts --check  → exit 1 if the committed files are stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApi } from '../src/server/api/openapi';

const dir = join(process.cwd(), 'openapi');
const check = process.argv.includes('--check');
let stale = false;
mkdirSync(dir, { recursive: true });
for (const api of ['mobile', 'admin'] as const) {
  const file = join(dir, `${api}.v1.json`);
  const next = JSON.stringify(buildOpenApi(api), null, 2) + '\n';
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {}
  if (current === next) continue;
  if (check) {
    console.error(`stale: ${file} (run npx tsx scripts/openapi.ts)`);
    stale = true;
  } else {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
  }
}
process.exit(stale ? 1 : 0);
