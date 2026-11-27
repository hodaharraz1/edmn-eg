import { and, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hashPassword } from '@/server/auth/password';
import { randomToken, sha256 } from '@/server/core/crypto';
import { absoluteUrl } from '@/server/core/urls';
import { sendDirect } from '@/server/modules/notifications/notify';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { forbidden, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { authTokens, privilegedRoleRequests, rolePermissions, roles, userRoles, users } from '@/server/db/schema';
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
    // M1: a brand-new account cannot be born privileged — an approved request has to name an existing account, so
    // the account is created without a role and the role is granted afterwards by two different super admins.
    if (privileged) throw validation('ما ينفعش تعمل حساب جديد بدور ذو صلاحيات عليا. اعمل الحساب من غير دور، وبعدها اطلب الدور بموافقة مدير عام تاني');
    const [u] = await tx.insert(users).values({ email, phone, fullName: input.fullName.trim(), passwordHash, isStaff: true, passwordChangedAt: new Date() }).returning();
    await tx.insert(userRoles).values({ userId: u.id, roleCode: input.role, grantedBy: actor.userId });
    const token = randomToken(32);
    await tx.insert(authTokens).values({ userId: u.id, purpose: 'PASSWORD_RESET', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600_000) });
    await sendDirect(tx, 'ACCOUNT_SECURITY', { email }, { message: `اتعمل لك حساب في فريق عمل اضمن. حدّد كلمة المرور بنفسك من الرابط ده خلال 72 ساعة: ${absoluteUrl(`/reset-password?token=${token}`)}\nبعد كده هتفعّل التحقق بخطوتين من تطبيق المصادقة عند أول دخول. لو مش متوقع الرسالة دي تجاهلها.` }, { subject: 'دعوة للانضمام لفريق عمل اضمن' });
    await audit(tx, actor, { action: privileged ? 'rbac.privileged_staff_created' : 'rbac.staff_created', entityType: 'user', entityId: u.id, newValues: { email, role: input.role, privileged }, reason: input.reason?.trim() || null });
    return u;
  });
}

export async function setStaffRole(
  actor: Actor,
  op: 'grant' | 'revoke',
  input: { userId: string; role: string; reason?: string | null; confirmPrivileged?: boolean; approvalRequestId?: string | null },
) {
  guard(actor);
  if (input.userId === actor.userId) throw validation('لا يمكنك تعديل أدوارك بنفسك');
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ isStaff: users.isStaff }).from(users).where(eq(users.id, input.userId)).for('update');
    if (!target?.isStaff) throw validation('الأدوار الإدارية لحسابات فريق العمل فقط');
    const [r] = await tx.select().from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    const privileged = await isPrivilegedRole(tx, input.role);
    if (privileged) {
      await assertPrivilegedAllowed(tx, actor, { confirm: input.confirmPrivileged, reason: input.reason });
      // M1: a privileged GRANT needs an approved second person; a revocation stays with one super admin (removing
      // privilege is never the dangerous direction).
      if (op === 'grant') await consumeApprovedRequest(tx, actor, input);
    }
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

/* ═══════════ SEC-04 M1: two people for a privileged role ═══════════
 * Before this change one SUPER_ADMIN could mint a second privileged account and use it as their own Checker.
 * Now: one super admin REQUESTS (Maker), a DIFFERENT super admin APPROVES (Checker) and executes the grant in the
 * same action. The pair is recorded, the approval is single-use, and the people behind the two accounts must be
 * distinguishable (same phone, same mailbox or the same network in the last day is refused as one person with two
 * accounts).
 */

/** Refuse an approval that looks like the same human behind two accounts. */
async function assertDistinctPeople(tx: DbOrTx, requesterId: string, approverId: string) {
  if (requesterId === approverId) throw forbidden('لازم شخص تاني يوافق: مينفعش توافق على طلب أنت اللي عملته');
  const rows = await tx.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, [requesterId, approverId]));
  const a = rows.find((r) => r.id === requesterId);
  const b = rows.find((r) => r.id === approverId);
  if (!a || !b) throw validation('حساب غير صالح');
  if (a.phone && b.phone && a.phone === b.phone) throw forbidden('نفس رقم الموبايل على الحسابين: لازم شخصين مختلفين فعلًا');
  if (a.email && b.email && a.email === b.email) throw forbidden('نفس البريد على الحسابين: لازم شخصين مختلفين فعلًا');
  const localPart = (e: string | null) => (e ?? '').split('@')[0].replace(/[.+].*$/, '');
  if (localPart(a.email) && localPart(a.email) === localPart(b.email)) throw forbidden('الحسابين بيشتركوا في نفس اسم البريد: لازم شخصين مختلفين فعلًا');
  const shared = await tx.execute<{ n: string }>(sql`select count(*)::text n from sessions s1 join sessions s2 on s1.ip = s2.ip
    where s1.user_id = ${requesterId} and s2.user_id = ${approverId} and s1.ip is not null
      and s1.created_at > now() - interval '24 hours' and s2.created_at > now() - interval '24 hours'`);
  if (Number(shared.rows[0]?.n ?? 0) > 0) throw forbidden('الحسابين دخلا من نفس عنوان الشبكة خلال آخر 24 ساعة: لازم شخصين مختلفين فعلًا');
}

/** Immediate security notice to every other active super admin (the audit row alone is not an alert). */
async function alertSuperAdmins(tx: DbOrTx, exceptUserId: string, message: string) {
  const rows = await tx.execute<{ email: string | null }>(sql`select u.email from user_roles ur join users u on u.id = ur.user_id
    where ur.role_code = 'SUPER_ADMIN' and u.status = 'ACTIVE' and u.id <> ${exceptUserId}`);
  for (const r of rows.rows) {
    if (r.email) await sendDirect(tx, 'ACCOUNT_SECURITY', { email: r.email }, { message }, { subject: 'تنبيه أمني: تغيير صلاحيات عليا في اضمن' });
  }
}

/** Maker step: open a request for a privileged role. Nothing is granted yet. */
export async function requestPrivilegedRole(actor: Actor, input: { userId: string; role: string; reason: string }) {
  guard(actor);
  if (input.userId === actor.userId) throw validation('لا يمكنك طلب دور لنفسك');
  const reason = (input.reason ?? '').trim();
  if (reason.length < 10) throw validation('اكتب سبب منح الدور (10 أحرف على الأقل)');
  return db.transaction(async (tx) => {
    if (!(await isSuperAdmin(tx, actor.userId!))) throw forbidden('طلب الصلاحيات العليا للمدير العام فقط');
    const [target] = await tx.select({ isStaff: users.isStaff, status: users.status }).from(users).where(eq(users.id, input.userId));
    if (!target?.isStaff) throw validation('الأدوار الإدارية لحسابات فريق العمل فقط');
    if (target.status !== 'ACTIVE') throw validation('الحساب مش نشط');
    const [r] = await tx.select({ code: roles.code }).from(roles).where(eq(roles.code, input.role));
    if (!r) throw validation('دور غير صالح');
    if (!(await isPrivilegedRole(tx, input.role))) throw validation('الدور ده مش من الصلاحيات العليا: امنحه مباشرة من غير طلب');
    const [req] = await tx
      .insert(privilegedRoleRequests)
      .values({ targetUserId: input.userId, roleCode: input.role, requestedBy: actor.userId!, reason })
      .returning();
    await audit(tx, actor, { action: 'rbac.privileged_role_requested', entityType: 'user', entityId: input.userId, newValues: { role: input.role, requestId: req.id }, reason });
    await alertSuperAdmins(tx, actor.userId!, `طلب منح الدور ${input.role} لحساب في فريق العمل محتاج موافقة مدير عام تاني. السبب: ${reason}`);
    return req;
  });
}

/** Checker step: a DIFFERENT super admin approves or rejects. An approval is single-use (CONSUMED on execution). */
export async function decidePrivilegedRoleRequest(actor: Actor, input: { requestId: string; approve: boolean; reason?: string | null }) {
  guard(actor);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(privilegedRoleRequests).where(eq(privilegedRoleRequests.id, input.requestId)).for('update');
    if (!req) throw validation('الطلب غير موجود');
    if (req.status !== 'PENDING') throw validation('الطلب ده اتحسم قبل كده');
    if (!(await isSuperAdmin(tx, actor.userId!))) throw forbidden('الموافقة على الصلاحيات العليا للمدير العام فقط');
    await assertDistinctPeople(tx, req.requestedBy, actor.userId!);
    const [updated] = await tx
      .update(privilegedRoleRequests)
      .set({ status: input.approve ? 'APPROVED' : 'REJECTED', decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(privilegedRoleRequests.id, req.id))
      .returning();
    await audit(tx, actor, {
      action: input.approve ? 'rbac.privileged_role_approved' : 'rbac.privileged_role_rejected',
      entityType: 'user',
      entityId: req.targetUserId,
      newValues: { role: req.roleCode, requestId: req.id },
      reason: input.reason?.trim() || null,
    });
    await alertSuperAdmins(tx, actor.userId!, `تم ${input.approve ? 'اعتماد' : 'رفض'} طلب منح الدور ${req.roleCode}. نفّذ المنح من شاشة الأدوار لو معتمد.`);
    return updated;
  });
}

/** Consume an APPROVED request (single use, 24 h, different person from the requester) — or refuse the grant. */
async function consumeApprovedRequest(tx: DbOrTx, actor: Actor, input: { userId: string; role: string; approvalRequestId?: string | null }) {
  if (!input.approvalRequestId) {
    throw validation('منح دور ذو صلاحيات عليا محتاج موافقة مدير عام تاني: اعمل طلب الأول ووافق عليه شخص مختلف');
  }
  const [req] = await tx.select().from(privilegedRoleRequests).where(eq(privilegedRoleRequests.id, input.approvalRequestId)).for('update');
  if (!req || req.status !== 'APPROVED') throw validation('الموافقة غير موجودة أو مش معتمدة');
  if (req.targetUserId !== input.userId || req.roleCode !== input.role) throw validation('الموافقة دي مش لنفس الحساب والدور');
  if (req.requestedBy === actor.userId) throw forbidden('مينفعش تنفّذ طلب أنت اللي عملته: لازم شخص تاني');
  if (!req.decidedAt || Date.now() - req.decidedAt.getTime() > 24 * 3600_000) throw validation('الموافقة قديمة (أكتر من 24 ساعة): اطلب موافقة جديدة');
  await tx.update(privilegedRoleRequests).set({ status: 'CONSUMED', consumedAt: new Date() }).where(eq(privilegedRoleRequests.id, req.id));
}

/** Staff holding a privileged role (for screens). */
export async function privilegedRoleCodes(conn: DbOrTx = db) {
  const rows = await conn.selectDistinct({ code: rolePermissions.roleCode }).from(rolePermissions).where(eq(rolePermissions.permission, 'roles.manage'));
  return [...new Set(['SUPER_ADMIN', ...rows.map((r) => r.code)])];
}

