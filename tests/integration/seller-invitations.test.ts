import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { customerActor, sellerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { auditLogs, notifications, sellerMemberInvitations, sellerMembers } from '@/server/db/schema';
import { decideSeller, inviteStaffMember, respondToStaffInvitation, revokeStaffInvitation, sellerContextForUser, staffInvitationsForUser } from '@/server/modules/sellers/service';
import { makeAdmin, makeSeller, makeUser } from '../helpers/factory';

/** F-6: store team membership is an invitation the invited account must explicitly accept. */

async function setup() {
  const admin = await makeAdmin();
  const s = await makeSeller(admin);
  const invitee = await makeUser({ name: 'عضو مدعو' });
  return { admin, owner: s.actor, ownerUser: s.user, sellerId: s.actor.sellerId!, invitee, inviteeActor: customerActor(invitee.id) };
}
const memberRow = async (sellerId: string, userId: string) => (await db.select().from(sellerMembers).where(and(eq(sellerMembers.sellerId, sellerId), eq(sellerMembers.userId, userId))))[0];
const auditActions = async (entityId: string) => (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, entityId))).map((r) => r.a);

describe('F-6 seller team invitations', () => {
  it('invite → PENDING; no membership and no Seller Center access while pending; the invitee is notified', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
    expect(inv.status).toBe('PENDING');
    expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
    expect(await sellerContextForUser(t.invitee.id)).toBeNull();
    expect(await sellerActor(t.invitee.id)).toBeNull();
    const notes = await db.select().from(notifications).where(eq(notifications.userId, t.invitee.id));
    expect(notes.some((n) => n.link === '/account/store-invitations')).toBe(true);
    expect((await staffInvitationsForUser(t.invitee.id)).map((r) => r.inv.id)).toContain(inv.id);
    expect(await auditActions(inv.id)).toContain('seller.staff_invited');
  });

  it('the intended user accepts → membership with exactly the invited role; RBAC follows the role; duplicate accept is idempotent', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
    const accepted = await respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT');
    expect(accepted.status).toBe('ACCEPTED');
    const m = await memberRow(t.sellerId, t.invitee.id);
    expect(m).toMatchObject({ role: 'ORDER_MANAGER', isActive: true });
    const ctx = await sellerActor(t.invitee.id);
    expect(ctx?.sellerId).toBe(t.sellerId);
    expect(ctx?.sellerPermissions?.has('orders.manage')).toBe(true);
    // An order manager is not a team manager and holds no finance/payout permission.
    expect(ctx?.sellerPermissions?.has('staff.manage')).toBe(false);
    expect(ctx?.sellerPermissions?.has('payout.manage')).toBe(false);
    await expect(inviteStaffMember(ctx!, (await makeUser()).email!, 'SUPPORT')).rejects.toThrow();
    // Retry is idempotent: same result, no second membership, one acceptance audit.
    const again = await respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT');
    expect(again.status).toBe('ACCEPTED');
    expect((await db.select().from(sellerMembers).where(eq(sellerMembers.userId, t.invitee.id))).length).toBe(1);
    expect((await auditActions(inv.id)).filter((a) => a === 'seller.staff_invitation_accepted')).toHaveLength(1);
    // Once accepted it can no longer be revoked as an invitation (removal is the membership action).
    await expect(revokeStaffInvitation(t.owner, inv.id)).rejects.toThrow(/اتردّ عليها/);
  });

  it('the intended user declines → no membership; cannot accept afterwards; owner is told', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'CATALOG_MANAGER');
    expect((await respondToStaffInvitation(t.inviteeActor, inv.id, 'DECLINE')).status).toBe('DECLINED');
    expect((await respondToStaffInvitation(t.inviteeActor, inv.id, 'DECLINE')).status).toBe('DECLINED');
    await expect(respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).rejects.toThrow(/اتردّ عليها/);
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
    expect(await auditActions(inv.id)).toContain('seller.staff_invitation_declined');
    const ownerNotes = await db.select().from(notifications).where(eq(notifications.userId, t.ownerUser.id));
    expect(ownerNotes.some((n) => n.body?.includes('رفض الدعوة'))).toBe(true);
  });

  it('owner revokes a pending invitation → it cannot be accepted; revoke retry is idempotent; a new invitation can then be sent', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT');
    await expect(inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT')).rejects.toThrow(/دعوة مفتوحة/);
    expect((await revokeStaffInvitation(t.owner, inv.id)).status).toBe('REVOKED');
    expect((await revokeStaffInvitation(t.owner, inv.id)).status).toBe('REVOKED');
    await expect(respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).rejects.toThrow(/لغى الدعوة/);
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
    expect(await auditActions(inv.id)).toContain('seller.staff_invitation_revoked');
    const fresh = await inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT');
    expect(fresh.id).not.toBe(inv.id);
  });

  it('another user cannot accept, decline, see or revoke the invitation (uniform not-found)', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
    const intruder = customerActor((await makeUser()).id);
    await expect(respondToStaffInvitation(intruder, inv.id, 'ACCEPT')).rejects.toThrow(/ملقيناش/);
    await expect(respondToStaffInvitation(intruder, inv.id, 'DECLINE')).rejects.toThrow(/ملقيناش/);
    await expect(respondToStaffInvitation(intruder, randomUUID(), 'ACCEPT')).rejects.toThrow(/ملقيناش/);
    await expect(respondToStaffInvitation(intruder, 'not-a-uuid', 'ACCEPT')).rejects.toThrow(/ملقيناش/);
    expect(await staffInvitationsForUser(intruder.userId!)).toHaveLength(0);
    // Another store's owner cannot revoke it either.
    const other = await makeSeller(t.admin);
    await expect(revokeStaffInvitation(other.actor, inv.id)).rejects.toThrow(/ملقيناش/);
    const [row] = await db.select().from(sellerMemberInvitations).where(eq(sellerMemberInvitations.id, inv.id));
    expect(row.status).toBe('PENDING');
  });

  it('concurrent accept and revoke resolve to exactly one outcome, consistent with membership', async () => {
    for (let i = 0; i < 3; i++) {
      const t = await setup();
      const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
      const [a, r] = await Promise.allSettled([respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT'), revokeStaffInvitation(t.owner, inv.id)]);
      const [row] = await db.select().from(sellerMemberInvitations).where(eq(sellerMemberInvitations.id, inv.id));
      const m = await memberRow(t.sellerId, t.invitee.id);
      expect(['ACCEPTED', 'REVOKED']).toContain(row.status);
      if (row.status === 'ACCEPTED') {
        expect(a.status).toBe('fulfilled');
        expect(r.status).toBe('rejected');
        expect(m?.isActive).toBe(true);
      } else {
        expect(r.status).toBe('fulfilled');
        expect(a.status).toBe('rejected');
        expect(m).toBeUndefined();
      }
    }
  });

  it('an expired invitation cannot be accepted and is marked EXPIRED', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
    await db.update(sellerMemberInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sellerMemberInvitations.id, inv.id));
    await expect(respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).rejects.toThrow(/انتهت صلاحيتها/);
    const [row] = await db.select().from(sellerMemberInvitations).where(eq(sellerMemberInvitations.id, inv.id));
    expect(row.status).toBe('EXPIRED');
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
    expect(await auditActions(inv.id)).toContain('seller.staff_invitation_expired');
  });

  it('a suspended or restricted store cannot invite, and a pending invitation cannot activate access while it is not in good standing', async () => {
    const t = await setup();
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'ORDER_MANAGER');
    await decideSeller(t.admin, t.sellerId, 'SUSPEND', 'إيقاف مؤقت للاختبار');
    await expect(respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).rejects.toThrow(/مش مفعّل/);
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
    const ownerNow = (await sellerActor(t.ownerUser.id))!;
    await expect(inviteStaffMember(ownerNow, (await makeUser()).email!, 'SUPPORT')).rejects.toThrow(/مش مفعّل/);
    await decideSeller(t.admin, t.sellerId, 'REINSTATE', 'إعادة التفعيل بعد المراجعة');
    await decideSeller(t.admin, t.sellerId, 'RESTRICT', 'تقييد مؤقت للاختبار');
    await expect(respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).rejects.toThrow(/مش مفعّل/);
    await decideSeller(t.admin, t.sellerId, 'REINSTATE', 'إعادة التفعيل بعد المراجعة');
    expect((await respondToStaffInvitation(t.inviteeActor, inv.id, 'ACCEPT')).status).toBe('ACCEPTED');
  });

  it('cannot invite staff accounts, store owners, existing members of another store, or yourself; invalid roles refused', async () => {
    const t = await setup();
    await expect(inviteStaffMember(t.owner, (await makeUser({ staff: true })).email!, 'SUPPORT')).rejects.toThrow(/فريق عمل اضمن/);
    const otherStore = await makeSeller(t.admin);
    await expect(inviteStaffMember(t.owner, otherStore.user.email!, 'SUPPORT')).rejects.toThrow(/عنده متجر/);
    await expect(inviteStaffMember(t.owner, t.ownerUser.email!, 'SUPPORT')).rejects.toThrow(/نفسك/);
    await expect(inviteStaffMember(t.owner, t.invitee.email!, 'STORE_OWNER')).rejects.toThrow(/دور غير صالح/);
    // Member of another store: accepted there first, then this store's invitation is refused at invite and accept time.
    const inv1 = await inviteStaffMember(otherStore.actor, t.invitee.email!, 'SUPPORT');
    const inv2 = await inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT');
    await respondToStaffInvitation(t.inviteeActor, inv1.id, 'ACCEPT');
    await expect(respondToStaffInvitation(t.inviteeActor, inv2.id, 'ACCEPT')).rejects.toThrow(/متجر تاني/);
    await expect(inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT')).rejects.toThrow(/دعوة مفتوحة|متجر تاني/);
    expect(await memberRow(t.sellerId, t.invitee.id)).toBeUndefined();
  });

  it('existing accepted memberships keep working (no historical rewrite); a team member without staff.manage cannot invite or revoke', async () => {
    const t = await setup();
    // A legacy membership row (created before invitations existed) still grants access unchanged.
    const legacy = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: t.sellerId, userId: legacy.id, role: 'CATALOG_MANAGER', isActive: true });
    const ctx = await sellerActor(legacy.id);
    expect(ctx?.sellerId).toBe(t.sellerId);
    expect(ctx?.sellerPermissions?.has('products.manage')).toBe(true);
    const inv = await inviteStaffMember(t.owner, t.invitee.email!, 'SUPPORT');
    await expect(inviteStaffMember(ctx!, (await makeUser()).email!, 'SUPPORT')).rejects.toThrow();
    await expect(revokeStaffInvitation(ctx!, inv.id)).rejects.toThrow();
    // A customer actor (not the seller) cannot revoke.
    await expect(revokeStaffInvitation(t.inviteeActor, inv.id)).rejects.toThrow();
  });
});
