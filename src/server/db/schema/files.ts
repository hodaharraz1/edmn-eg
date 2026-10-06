import { bigint, customType, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, ts } from './_helpers';
import { users } from './identity';

export const FILE_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export const FILE_PURPOSES = [
  'PRODUCT_IMAGE',
  'STORE_LOGO',
  'STORE_BANNER',
  'CATEGORY_IMAGE',
  'BRAND_LOGO',
  'CMS_IMAGE',
  'REVIEW_PHOTO',
  'SELLER_DOCUMENT',
  'PAYMENT_PROOF',
  'SHIPPING_WAYBILL',
  'RETURN_EVIDENCE',
  'DISPUTE_EVIDENCE',
  'DEAL_EVIDENCE',
  'WITHDRAWAL_PROOF',
  'REFUND_PROOF',
  'SUPPORT_ATTACHMENT',
  'MESSAGE_ATTACHMENT',
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * Metadata for every stored object. PRIVATE files are never reachable by a predictable URL:
 * they are streamed by /api/files/[id] only after an authorization check bound to `purpose`.
 */
export const files = pgTable(
  'files',
  {
    id: uuid().primaryKey().defaultRandom(),
    visibility: text({ enum: FILE_VISIBILITIES }).notNull(),
    purpose: text({ enum: FILE_PURPOSES }).notNull(),
    storageKey: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    sha256: text().notNull(),
    width: integer(),
    height: integer(),
    /** For images: storage keys of derived renditions {thumb, medium} */
    variantKeys: text().array(),
    originalName: text(), // display only — never used to build paths
    ownerUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
    deletedAt: ts(),
  },
  (t) => [
    uniqueIndex('files_storage_key_uq').on(t.storageKey),
    index('files_owner_idx').on(t.ownerUserId),
    enumCheck('files_visibility_chk', t.visibility, FILE_VISIBILITIES),
    enumCheck('files_purpose_chk', t.purpose, FILE_PURPOSES),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Object bytes for STORAGE_DRIVER=database (hosts without a persistent disk, e.g. free staging).
 * Same keys and visibility split as the disk driver; access control stays in the `files` rules.
 */
export const storedObjects = pgTable(
  'stored_objects',
  {
    visibility: text({ enum: FILE_VISIBILITIES }).notNull(),
    key: text().notNull(),
    data: bytea().notNull(),
    size: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.visibility, t.key] })],
);
