import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatEGP } from '@/lib/format';

/** Guardrails for docs/BRAND_EGYPT_MARKET_IDENTITY.md — EDMN is an Egyptian marketplace, never a Gulf one. */

const ROOT = path.resolve(import.meta.dirname, '../..');
function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.test(e)) out.push(p);
  }
  return out;
}
const sources = walk(path.join(ROOT, 'src'), /\.(tsx?|css|json)$/).map((p) => ({ p: path.relative(ROOT, p), s: readFileSync(p, 'utf8') }));

describe('Egyptian market identity', () => {
  it('prices are EGP: formatEGP renders ج.م', () => {
    expect(formatEGP(1299900)).toBe('12,999 ج.م');
  });
  it('no Gulf / foreign marketplace currency in the application source', () => {
    const bad = /\b(SAR|AED|KWD|QAR|BHD|OMR)\b|ريال|درهم|ر\.س|د\.إ|\bUSD\b|دولار/;
    expect(sources.filter((f) => bad.test(f.s)).map((f) => f.p)).toEqual([]);
  });
  it('no Gulf cities or countries in the application source (Egyptian places only)', () => {
    const bad = /\b(Riyadh|Jeddah|Dubai|Abu Dhabi|Doha|Kuwait|Saudi|Emirati|UAE)\b|الرياض|جدة|دبي|أبو ?ظبي|الدوحة|الكويت|السعودية|الإمارات|الشارقة/;
    expect(sources.filter((f) => bad.test(f.s)).map((f) => f.p)).toEqual([]);
  });
  it('every raster image in public/ is listed (and justified) in the brand identity document', () => {
    const doc = readFileSync(path.join(ROOT, 'docs/BRAND_EGYPT_MARKET_IDENTITY.md'), 'utf8');
    const rasters = walk(path.join(ROOT, 'public'), /\.(png|jpe?g|webp|gif|avif)$/i).map((p) => path.relative(ROOT, p));
    for (const r of rasters) expect(doc, `${r} must be listed in docs/BRAND_EGYPT_MARKET_IDENTITY.md §5`).toContain(`\`${r}\``);
  });
});
