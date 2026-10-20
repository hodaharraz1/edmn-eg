import { and, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hashPassword } from '@/server/auth/password';
import { randomToken, sha256 } from '@/server/core/crypto';
import { absoluteUrl } from '@/server/core/urls';
import { sendDirect } from '@/server/modules/notifications/notify';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { forbidden, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { authTokens, rolePermissions, roles, userRoles, users } from '@/server/db/schema';
import { ALL_PERMISSIONS, type Permission } from './permissions';

/**
 * Staff accounts and role assignment — the ONLY place staff roles are created, granted, revoked or edited.
 * Every path requires `roles.manage` + fresh 2FA. A PRIVILEGED role (SUPER_ADMIN, or any role that carries
 * `roles.manage`) can only be created/granted/revoked/edited by an existing SUPER_ADMIN (checked in the
 * database, never from the form), with an explicit confirmation and a written reason; all of it audited
 * and transactional. No alternate route (create, grant, edit a role's permissions) can bypass this.
 */

async function heldRoles(conn: DbOrTx, userId: string) {
  return (await conn.select({ code: userRoles.roleCode }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.code);
}

export async function isSuperAdmin(conn: DbOrTx, userId: string) {
  return (await heldRoles(conn, userId)).includes('SUPER_ADMIN');
}

/**
 * Permissions that move or decide money. A role carrying any of them is PRIVILEGED (Batch final audit F-1): only a
 * SUPER_ADMIN may create/grant/revoke/edit it, so one `roles.manage` holder can never mint a second staff identity
 * with money powers to act as their own Checker.
 */
export const MONEY_PERMISSIONS: readonly Permission[] = [
  'payments.verify', 'payments.destinations.manage', 'refunds.approve', 'refunds.pay', 'refunds.destination.override', 'deals.payout',
  'withdrawals.approve', 'withdrawals.pay', 'ledger.adjust.create', 'ledger.adjust.approve', 'settlements.manage', 'finance.release',
  'finance.controls', 'destinations.review', 'finance.movement.request',
] as Permission[];

/** SUPER_ADMIN, any role that carries `roles.manage` (it could mint further privilege), or any money permission. */
export async function isPrivilegedRole(conn: DbOrTx, roleCode: string) {
  if (roleCode === 'SUPER_ADMIN') return true;
  const r = await conn.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleCode, roleCode));
  return r.some((x) => x.p === 'roles.manage' || (MONEY_PERMISSIONS as string[]).includes(x.p));
}

function guard(actor: Actor) {
  requirePermission(actor, 'roles.manage');
  requireStepUp(actor);
}

async function assertPrivilegedAllowed(tx: DbOrTx, actor: Actor, opts: { confirm?: boolean; reason?: string | null }) {
  if (!(await isSuperAdmin(tx, actor.userId!))) throw forbidden('منح أو سحب أو تعديل الأدوار ذات الصلاحيات العليا متاح للمدير العام فقط');
  if (!opts.confirm) throw validation('هذا إجراء ذو صلاحيات عليا: أكّد الإجراء صراحةً');
  if (!opts.reason || opts.reason.trim().length < 10) throw validation('اكتب سبب الإجراء (10 أحرف على الأقل)');
}

/**
 * Creates a staff account WITHOUT a creator-known password (F-1): the account gets an unusable random password and
 * the new staff member receives a one-time invitation link (72 h) to set their own password; they then enroll their
 * own 2FA at first login. The creator can therefore never sign in as the person they created.
 */
export async function createStaffUser(
  actor: Actor,
  input: { email: string; phone: string; fullName: string; role: string; reason?: string | null; confirmPrivileged?: boolean },
) {
  guard(actor);
  const email = input.email.trim().toLowerCase();
  const phone = normalizeEgyptMobile(input.phone);
  if (!phone) throw validation('رقم الموبايل غير صحيح');
  if (!email || !input.fullName?.trim()) throw validation('الاسم والبريد مطلوبان');
  const passwordHash = await hashPassword(randomToken(48) + 'Aa1!');
  return db.transaction(async (tx) => {
    // Validate the role BEFORE anything is written (no orphan staff account on a refused role).
    const [r] = await tx.select().from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    const privileged = await isPrivilegedRole(tx, input.role);
    if (privileged) await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
    const [u] = await tx.insert(users).values({ email, phone, fullName: input.fullName.trim(), passwordHash, isStaff: true, passwordChangedAt: new Date() }).returning();
    await tx.insert(userRoles).values({ userId: u.id, roleCode: input.role, grantedBy: actor.userId });
    const token = randomToken(32);
    await tx.insert(authTokens).values({ userId: u.id, purpose: 'PASSWORD_RESET', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600_000) });
    await sendDirect(tx, 'ACCOUNT_SECURITY', { email }, { message: `اتعمل لك حساب في فريق عمل اضمن. حدّد كلمة المرور بنفسك من الرابط ده خلال 72 ساعة: ${absoluteUrl(`/reset-password?token=${token}`)}\nبعد كده هتفعّل التحقق بخطوتين من تطبيق المصادقة عند أول دخول. لو مش متوقع الرسالة دي تجاهلها.` }, { subject: 'دعوة للانضمام لفريق عمل اضمن' });
    await audit(tx, actor, { action: privileged ? 'rbac.privileged_staff_created' : 'rbac.staff_created', entityType: 'user', entityId: u.id, newValues: { email, role: input.role, privileged }, reason: input.reason?.trim() || null });
    return u;
  });
}

export async function setStaffRole(actor: Actor, op: 'grant' | 'revoke', input: { userId: string; role: string; reason?: string | null; confirmPrivileged?: boolean }) {
  guard(actor);
  if (input.userId === actor.userId) throw validation('لا يمكنك تعديل أدوارك بنفسك');
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ isStaff: users.isStaff }).from(users).where(eq(users.id, input.userId)).for('update');
    if (!target?.isStaff) throw validation('الأدوار الإدارية لحسابات فريق العمل فقط');
    const [r] = await tx.select().from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    const privileged = await isPrivilegedRole(tx, input.role);
    if (privileged) await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
    if (op === 'grant') await tx.insert(userRoles).values({ userId: input.userId, roleCode: input.role, grantedBy: actor.userId }).onConflictDoNothing();
    else {
      if (input.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(tx, input.userId);
      await tx.delete(userRoles).where(and(eq(userRoles.userId, input.userId), eq(userRoles.roleCode, input.role)));
    }
    await audit(tx, actor, { action: `rbac.role_${op}`, entityType: 'user', entityId: input.userId, newValues: { role: input.role, privileged }, reason: input.reason?.trim() || null });
  });
}

async function assertNotLastSuperAdmin(tx: DbOrTx, userId: string) {
  const r = await tx.execute<{ n: string }>(sql`select count(*)::text n from user_roles ur join users u on u.id = ur.user_id
    where ur.role_code = 'SUPER_ADMIN' and u.status = 'ACTIVE' and u.id <> ${userId}`);
  if (Number(r.rows[0]?.n ?? 0) === 0) throw validation('لا يمكن إزالة آخر مدير عام نشط');
}

export async function setStaffStatus(actor: Actor, input: { userId: string; status: 'ACTIVE' | 'DISABLED'; reason?: string | null; confirmPrivileged?: boolean }) {
  guard(actor);
  if (input.userId === actor.userId) throw validation('لا يمكنك تعطيل حسابك');
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ isStaff: users.isStaff }).from(users).where(eq(users.id, input.userId)).for('update');
    if (!target?.isStaff) throw validation('تعطيل حسابات العملاء يتم من صفحة العملاء');
    const held = await heldRoles(tx, input.userId);
    let privileged = false;
    for (const code of held) if (await isPrivilegedRole(tx, code)) privileged = true;
    if (privileged) {
      await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
      if (input.status === 'DISABLED' && held.includes('SUPER_ADMIN')) await assertNotLastSuperAdmin(tx, input.userId);
    }
    await tx.update(users).set({ status: input.status }).where(eq(users.id, input.userId));
    await audit(tx, actor, { action: 'rbac.staff_status', entityType: 'user', entityId: input.userId, newValues: { status: input.status, privileged }, reason: input.reason?.trim() || null });
  });
}

/** Replace a role's permission set. SUPER_ADMIN is fixed; a role you hold is off limits; privilege needs a SUPER_ADMIN. */
export async function setRolePermissions(actor: Actor, input: { role: string; permissions: string[]; reason?: string | null; confirmPrivileged?: boolean }) {
  guard(actor);
  if (input.role === 'SUPER_ADMIN') throw validation('لا يمكن تعديل صلاحيات المدير العام');
  const perms = [...new Set(input.permissions)].filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    if ((await heldRoles(tx, actor.userId!)).includes(input.role)) throw validation('لا يمكنك تعديل صلاحيات دور تحمله أنت');
    // Making a role privileged (roles.manage or any money permission), or editing an already-privileged role, is a SUPER_ADMIN decision.
    if (perms.some((p) => p === 'roles.manage' || (MONEY_PERMISSIONS as string[]).includes(p)) || (await isPrivilegedRole(tx, input.role))) await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
    if (!input.reason || input.reason.trim().length < 3) throw validation('اكتب سبب التعديل');
    const old = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleCode, input.role));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleCode, input.role));
    if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleCode: input.role, permission: p })));
    await audit(tx, actor, { action: 'rbac.role_permissions_changed', entityType: 'role', entityId: input.role, oldValues: { permissions: old.map((o) => o.permission) }, newValues: { permissions: perms }, reason: input.reason });
  });
}

/** Staff holding a privileged role (for screens). */
export async function privilegedRoleCodes(conn: DbOrTx = db) {
  const rows = await conn.selectDistinct({ code: rolePermissions.roleCode }).from(rolePermissions).where(eq(rolePermissions.permission, 'roles.manage'));
  return [...new Set(['SUPER_ADMIN', ...rows.map((r) => r.code)])];
}

