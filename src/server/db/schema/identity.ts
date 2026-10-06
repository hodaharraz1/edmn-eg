import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, ts, updatedAt } from './_helpers';

/** CLOSED = account closed on request after all obligations were settled (history kept, PII pseudonymised). */
export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DISABLED', 'CLOSED'] as const;

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text(), // stored lower-cased
    phone: text(), // E.164 (+20…)
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    status: text({ enum: USER_STATUSES }).notNull().default('ACTIVE'),
    isStaff: boolean().notNull().default(false),
    locale: text().notNull().default('ar'),
    emailVerifiedAt: ts(),
    phoneVerifiedAt: ts(),
    totpSecretEnc: text(),
    totpEnabledAt: ts(),
    /** Last accepted TOTP time-step; a code is accepted at most once (replay protection). */
    totpLastStep: bigint({ mode: 'number' }),
    passwordChangedAt: ts(),
    lastLoginAt: ts(),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: ts(),
    closedAt: ts(),
    anonymizedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email).where(sql`${t.email} is not null`),
    uniqueIndex('users_phone_uq').on(t.phone).where(sql`${t.phone} is not null`),
    enumCheck('users_status_chk', t.status, USER_STATUSES),
    index('users_staff_idx').on(t.isStaff),
  ],
);

export const SESSION_SCOPES = ['WEB', 'ADMIN'] as const;

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(), // sha256(token) — the raw token only exists in the cookie
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text({ enum: SESSION_SCOPES }).notNull(),
    mfaVerifiedAt: ts(),
    stepUpAt: ts(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), enumCheck('sessions_scope_chk', t.scope, SESSION_SCOPES)],
);

export const AUTH_TOKEN_PURPOSES = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'PHONE_VERIFY'] as const;

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text({ enum: AUTH_TOKEN_PURPOSES }).notNull(),
    tokenHash: text().notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash),
    index('auth_tokens_user_idx').on(t.userId, t.purpose),
    enumCheck('auth_tokens_purpose_chk', t.purpose, AUTH_TOKEN_PURPOSES),
  ],
);

/** Fixed-window rate limiting shared across app instances. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text().notNull(),
    windowStart: ts().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/* ───────── RBAC (staff) ───────── */
export const roles = pgTable('roles', {
  code: text().primaryKey(),
  nameAr: text().notNull(),
  nameEn: text().notNull(),
  description: text(),
  isSystem: boolean().notNull().default(false),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleCode: text()
      .notNull()
      .references(() => roles.code, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permission] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleCode: text()
      .notNull()
      .references(() => roles.code, { onDelete: 'restrict' }),
    grantedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleCode] })],
);

/* ───────── Reference data ───────── */
export const governorates = pgTable('governorates', {
  id: integer().primaryKey(),
  code: text().notNull().unique(),
  nameAr: text().notNull(),
  nameEn: text().notNull(),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
});

export const addresses = pgTable(
  'addresses',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text(),
    recipientName: text().notNull(),
    phone: text().notNull(),
    governorateId: integer()
      .notNull()
      .references(() => governorates.id),
    city: text().notNull(),
    district: text(),
    street: text().notNull(),
    building: text(),
    floor: text(),
    apartment: text(),
    landmark: text(),
    /** Optional GPS pin {lat,lng,accuracy}, captured only after explicit browser permission; AES-GCM encrypted. */
    locationEnc: text(),
    isDefault: boolean().notNull().default(false),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

/* ───────── Audit (append-only; UPDATE/DELETE blocked by trigger) ───────── */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorUserId: uuid(),
    actorType: text().notNull(), // CUSTOMER | SELLER | ADMIN | SYSTEM | ANONYMOUS
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    oldValues: jsonb(),
    newValues: jsonb(),
    reason: text(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorUserId),
    index('audit_action_idx').on(t.action),
    index('audit_created_idx').on(t.createdAt),
  ],
);

/** Every status change of every state machine is recorded here (append-only). */
export const statusHistory = pgTable(
  'status_history',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorUserId: uuid(),
    actorType: text().notNull(),
    reason: text(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index('status_history_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
);

/* ───────── System settings (typed in code; values editable by authorized admins) ───────── */
export const systemSettings = pgTable('system_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => users.id),
  updatedAt: updatedAt(),
});

/* ───────── Client idempotency keys (forms embed a key; retries return the original result) ───────── */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text().notNull(),
    key: text().notNull(),
    resultRef: text(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);
