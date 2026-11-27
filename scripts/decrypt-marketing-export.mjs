#!/usr/bin/env node
/**
 * Decrypt a PKG-PRIVACY-01 marketing audience export.
 * Usage: node scripts/decrypt-marketing-export.mjs <encrypted-file> <passphrase> [output.csv]
 * The passphrase is the one-time value shown to the executing approver; it is never stored server-side.
 * Node.js stdlib only (crypto, fs) — matches src/server/modules/customers/marketing.ts encryptExport.
 */
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , encPath, passphrase, outPath] = process.argv;
if (!encPath || !passphrase) {
  console.error('Usage: node scripts/decrypt-marketing-export.mjs <encrypted-file> <passphrase> [output.csv]');
  process.exit(1);
}
const env = JSON.parse(Buffer.from(readFileSync(encPath), 'base64').toString('utf8'));
if (env.v !== 1 || env.alg !== 'AES-256-GCM' || env.kdf !== 'scrypt' || !env.salt || !env.iv || !env.tag || !env.data) {
  console.error('Not a recognized EDMN marketing export envelope.');
  process.exit(1);
}
const key = scryptSync(passphrase, Buffer.from(env.salt, 'base64'), 32);
const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
dec.setAuthTag(Buffer.from(env.tag, 'base64'));
let csv;
try {
  csv = Buffer.concat([dec.update(Buffer.from(env.data, 'base64')), dec.final()]);
} catch {
  console.error('Decryption failed — wrong passphrase or corrupted file.');
  process.exit(1);
}
if (outPath) {
  writeFileSync(outPath, csv);
  console.error(`OK — ${outPath} (${csv.length} bytes)`);
} else {
  process.stdout.write(csv);
}
