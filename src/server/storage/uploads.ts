import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { requireUser, type Actor } from '@/server/core/actor';
import { sha256 } from '@/server/core/crypto';
import { env } from '@/server/core/env';
import { validation } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import type { DbOrTx } from '@/server/db/client';
import { files, type FilePurpose } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { storage } from './storage';

type Kind = 'jpeg' | 'png' | 'webp' | 'pdf';

/** Detect the real file type from magic bytes — the client-declared MIME type and filename are never trusted. */
export function sniff(buf: Buffer): Kind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  return null;
}

const PUBLIC_PURPOSES: ReadonlySet<FilePurpose> = new Set([
  'PRODUCT_IMAGE',
  'STORE_LOGO',
  'STORE_BANNER',
  'CATEGORY_IMAGE',
  'BRAND_LOGO',
  'CMS_IMAGE',
  'REVIEW_PHOTO',
]);
const IMAGE_ONLY: ReadonlySet<FilePurpose> = new Set([...PUBLIC_PURPOSES]);
const ALLOWED_EXT = /\.(jpe?g|png|webp|pdf)$/i;

export interface UploadInput {
  purpose: FilePurpose;
  data: Buffer;
  originalName?: string | null;
}

export interface StoredFile {
  id: string;
  storageKey: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeType: string;
}

export async function fileFromForm(value: FormDataEntryValue | null): Promise<{ data: Buffer; name: string } | null> {
  if (!value || typeof value === 'string') return null;
  if (value.size === 0) return null;
  return { data: Buffer.from(await value.arrayBuffer()), name: value.name };
}

/**
 * Validate + normalize + store an upload, returning the `files` row id.
 * Images are re-encoded with sharp (auto-orient, metadata/EXIF/GPS stripped), which also
 * neutralizes polyglot payloads. PDFs are accepted only for document purposes.
 */
export async function storeUpload(tx: DbOrTx, actor: Actor, input: UploadInput): Promise<StoredFile> {
  const userId = requireUser(actor);
  const kind = sniff(input.data);
  if (!kind) throw validation('نوع الملف غير مدعوم. الأنواع المسموح بها: JPG, PNG, WEBP, PDF');
  if (input.originalName && !ALLOWED_EXT.test(input.originalName)) throw validation('امتداد الملف غير مسموح');
  if (kind === 'pdf' && IMAGE_ONLY.has(input.purpose)) throw validation('يجب رفع صورة (JPG / PNG / WEBP)');

  // The admin setting can only lower the deployment's hard cap (UPLOAD_MAX_*_MB), never raise it.
  const maxMb =
    kind === 'pdf'
      ? Math.min(await getSetting('uploads.maxDocumentMb', tx), env().UPLOAD_MAX_DOCUMENT_MB)
      : Math.min(await getSetting('uploads.maxImageMb', tx), env().UPLOAD_MAX_IMAGE_MB);
  if (input.data.length > maxMb * 1024 * 1024) throw validation(`حجم الملف يتجاوز الحد المسموح (${maxMb} ميجابايت)`);

  const visibility = PUBLIC_PURPOSES.has(input.purpose) ? 'PUBLIC' : 'PRIVATE';
  const id = randomUUID();
  const now = new Date();
  const prefix = `${input.purpose.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let body: Buffer;
  let ext: 'webp' | 'jpg' | 'pdf';
  let mime: string;
  let width: number | null = null;
  let height: number | null = null;
  const variantKeys: string[] = [];

  if (kind === 'pdf') {
    body = input.data;
    ext = 'pdf';
    mime = 'application/pdf';
  } else {
    try {
      const img = sharp(input.data, { failOn: 'error', limitInputPixels: 25_000_000 }).rotate();
      const meta = await img.metadata();
      if (!meta.width || !meta.height || meta.width < 50 || meta.height < 50) throw validation('أبعاد الصورة صغيرة جداً');
      const out = await img
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
      body = out.data;
      width = out.info.width;
      height = out.info.height;
      ext = 'webp';
      mime = 'image/webp';
    } catch (e) {
      if (e instanceof Error && e.name === 'DomainError') throw e;
      logger.warn('upload.image_decode_failed', { purpose: input.purpose, error: (e as Error).message });
      throw validation('تعذّر قراءة الصورة. تأكد من أن الملف صورة سليمة');
    }
  }

  const storageKey = `${prefix}/${id}.${ext}`;
  await storage().put(visibility, storageKey, body);

  if (visibility === 'PUBLIC' && kind !== 'pdf') {
    for (const [suffix, size] of [
      ['thumb', 320],
      ['md', 800],
    ] as const) {
      const v = await sharp(body).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const k = `${prefix}/${id}_${suffix}.webp`;
      await storage().put(visibility, k, v);
      variantKeys.push(k);
    }
  }

  await tx.insert(files).values({
    id,
    visibility,
    purpose: input.purpose,
    storageKey,
    mimeType: mime,
    sizeBytes: body.length,
    sha256: sha256(body),
    width,
    height,
    variantKeys,
    originalName: input.originalName ? input.originalName.slice(0, 120) : null,
    ownerUserId: userId,
  });
  return { id, storageKey, visibility, mimeType: mime };
}

/** Public URL for a PUBLIC file (optionally a resized rendition). */
export function publicUrl(storageKey: string | null | undefined, size?: 'thumb' | 'md'): string | null {
  if (!storageKey) return null;
  const key = size ? storageKey.replace(/\.webp$/, `_${size}.webp`) : storageKey;
  return `/media/${key}`;
}
