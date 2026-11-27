import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adminActor, customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { accountClosureRequests, auditLogs, users } from '@/server/db/schema';
import { completeAccountClosure, requestAccountClosure, requestClosureExecution } from '@/server/modules/customers/closure';
import { makeAdmin, makeCustomer, makeUser } from '../helpers/factory';

/**
 * PKG-SEC-FIX-01 (SEC-164): completing an account closure is irreversible (name, email, phone pseudonymised, sessions
 * revoked). It needs a fresh step-up AND two different staff members (Maker requests execution, Checker completes),
 * the same pattern as financial movements. Without both, nothing on the account may change.
 */
async function pending() {
  const c = await makeCustomer();
  const req = await requestAccountClosure(customerActor(c.user.id), 'مش محتاج الحساب');
  expect(req.status).toBe('PENDING');
  return { c, requestId: req.requestId! };
}
async function untouched(userId: string, requestId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  expect(u.status).toBe('ACTIVE');
  expect(u.email).not.toBeNull();
  expect(u.anonymizedAt).toBeNull();
  const [r] = await db.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, requestId));
  expect(r.status).toBe('PENDING');
}
const noStepUpStaff = async () => adminActor((await makeUser({ staff: true, roles: ['SUPER_ADMIN'] })).id, {});

describe('SEC-164: account closure needs step-up and two different staff members', () => {
  it('step-up: no step-up (or an expired one) is refused for both the request and the completion, account untouched', async () => {
    const { c, requestId } = await pending();
    await expect(requestClosureExecution(await noStepUpStaff(), requestId)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const maker = await makeAdmin();
    await requestClosureExecution(maker, requestId);
    await expect(completeAccountClosure(await noStepUpStaff(), requestId)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const staff = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    const stale = await adminActor(staff.id, { stepUpAt: new Date(Date.now() - 24 * 3600 * 1000) });
    await expect(completeAccountClosure(stale, requestId)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await untouched(c.user.id, requestId);
  });

  it('two people: nobody can complete without a Maker, and the Maker can never be the Checker', async () => {
    const { c, requestId } = await pending();
    const maker = await makeAdmin();
    await expect(completeAccountClosure(maker, requestId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const first = await requestClosureExecution(maker, requestId);
    expect(first.requested).toBe(true);
    expect((await requestClosureExecution(maker, requestId)).requested).toBe(false); // repeat is a no-op
    await expect(completeAccountClosure(maker, requestId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await untouched(c.user.id, requestId);
  });

  it('a different staff member with a fresh step-up completes it; both steps are audited', async () => {
    const { c, requestId } = await pending();
    const maker = await makeAdmin();
    const checker = await makeAdmin();
    await requestClosureExecution(maker, requestId);
    const done = await completeAccountClosure(checker, requestId);
    expect(done.closed).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, c.user.id));
    expect(u.status).toBe('CLOSED');
    const [r] = await db.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, requestId));
    expect(r.executionRequestedBy).toBe(maker.userId);
    expect(r.decidedBy).toBe(checker.userId);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, c.user.id))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['account.closure_execution_requested', 'account.closed']));
  });

  it('DB level: a COMPLETED closure with the same person as Maker and Checker, or no Maker, is rejected by the table', async () => {
    const { requestId } = await pending();
    const a = await makeAdmin();
    const rejected = (e: unknown) => String((e as { cause?: { message?: string }; message?: string }).cause?.message ?? (e as Error).message);
    const same = db.execute(sql`update account_closure_requests set status = 'COMPLETED', execution_requested_by = ${a.userId}, decided_by = ${a.userId} where id = ${requestId}`);
    await expect(same.catch((e) => { throw new Error(rejected(e)); })).rejects.toThrow(/account_closure_two_person_chk/);
    const none = db.execute(sql`update account_closure_requests set status = 'COMPLETED', decided_by = ${a.userId} where id = ${requestId}`);
    await expect(none.catch((e) => { throw new Error(rejected(e)); })).rejects.toThrow(/account_closure_two_person_chk/);
  });
});
