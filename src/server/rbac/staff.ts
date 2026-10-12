import { and, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hashPassword, passwordProblems, STAFF_POLICY } from '@/server/auth/password';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { forbidden, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { rolePermissions, roles, userRoles, users } from '@/server/db/schema';
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

/** SUPER_ADMIN or any role that carries `roles.manage` (it could mint further privilege). */
export async function isPrivilegedRole(conn: DbOrTx, roleCode: string) {
  if (roleCode === 'SUPER_ADMIN') return true;
  const r = await conn.select().from(rolePermissions).where(and(eq(rolePermissions.roleCode, roleCode), eq(rolePermissions.permission, 'roles.manage')));
  return r.length > 0;
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

export async function createStaffUser(
  actor: Actor,
  input: { email: string; phone: string; fullName: string; password: string; role: string; reason?: string | null; confirmPrivileged?: boolean },
) {
  guard(actor);
  const email = input.email.trim().toLowerCase();
  const phone = normalizeEgyptMobile(input.phone);
  const problem = passwordProblems(input.password, STAFF_POLICY);
  if (problem) throw validation(problem);
  if (!phone) throw validation('رقم الموبايل غير صحيح');
  if (!email || !input.fullName?.trim()) throw validation('الاسم والبريد مطلوبان');
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // Validate the role BEFORE anything is written (no orphan staff account on a refused role).
    const [r] = await tx.select().from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    const privileged = await isPrivilegedRole(tx, input.role);
    if (privileged) await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
    const [u] = await tx.insert(users).values({ email, phone, fullName: input.fullName.trim(), passwordHash, isStaff: true, passwordChangedAt: new Date() }).returning();
    await tx.insert(userRoles).values({ userId: u.id, roleCode: input.role, grantedBy: actor.userId });
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
    // Making a role privileged, or editing an already-privileged role, is a SUPER_ADMIN decision.
    if (perms.includes('roles.manage') || (await isPrivilegedRole(tx, input.role))) await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
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

