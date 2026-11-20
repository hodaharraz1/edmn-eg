/**
 * Staff side of the mobile UI journeys, LOCAL demo database only. The journeys drive the buyer and seller through the
 * real Flutter app; the steps that belong to EDMN staff in the web console (payment confirmation, KYC and seller
 * approval, product moderation) run here through the SAME service functions the console calls, as the demo admin with a
 * fresh 2FA (step-up) — nothing is written to the database directly, no rule is bypassed.
 *
 *   npx tsx docs/mobile/journeys/staff-step.ts <command> <arg>
 *     confirm-payment <orderNumber>     latest submitted receipt of that order's payment
 *     approve-identity <email>          the user's pending national-ID verification
 *     approve-seller <email>            the user's seller application, then verifies its payout account
 *     approve-product <productId>
 *     ledger-health                     the scheduler's ledger health snapshot (computed, never forced: a failing ledger stays blocked)
 */
import '../../../scripts/_env';
import { and, desc, eq } from 'drizzle-orm';
import { adminActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { orders, paymentSubmissions, payments, sellerPayoutMethods, sellers, userIdentityVerifications, users } from '@/server/db/schema';
import { moderateProduct } from '@/server/modules/catalog/products';
import { runLedgerHealthCheck } from '@/server/modules/finance/ledger-health';
import { reviewIdentity } from '@/server/modules/identity/service';
import { confirmPayment } from '@/server/modules/payments/service';
import { decideSeller, verifyPayoutMethod } from '@/server/modules/sellers/service';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('staff-step runs against a LOCAL demo database only');

async function staff(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`no staff ${email}`);
  return adminActor(u.id, { stepUpAt: new Date() });
}
const userId = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const admin = await staff('admin@edmn.local');
  switch (cmd) {
    case 'confirm-payment': {
      const [o] = await db
        .select()
        .from(orders)
        .where(eq(orders.number, Number(arg)));
      const [p] = await db.select().from(payments).where(eq(payments.orderId, o.id));
      const [s] = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, p.id)).orderBy(desc(paymentSubmissions.createdAt)).limit(1);
      await confirmPayment(await staff('payments@edmn.local').catch(() => admin), p.id, s.id, 'UI journey (test money)');
      break;
    }
    case 'approve-identity': {
      const [v] = await db
        .select()
        .from(userIdentityVerifications)
        .where(and(eq(userIdentityVerifications.userId, await userId(arg)), eq(userIdentityVerifications.status, 'PENDING_REVIEW')));
      await reviewIdentity(admin, v.id, 'APPROVE');
      break;
    }
    case 'approve-seller': {
      const [s] = await db
        .select()
        .from(sellers)
        .where(eq(sellers.ownerUserId, await userId(arg)));
      await decideSeller(admin, s.id, 'APPROVE');
      const [pm] = await db
        .select()
        .from(sellerPayoutMethods)
        .where(and(eq(sellerPayoutMethods.sellerId, s.id), eq(sellerPayoutMethods.status, 'PENDING_VERIFICATION')));
      if (pm) await verifyPayoutMethod(admin, pm.id, true, 'UI journey');
      break;
    }
    case 'approve-product':
      await moderateProduct(admin, arg, 'APPROVE');
      break;
    case 'ledger-health': {
      const h = await runLedgerHealthCheck('ui-journey');
      if (h.status !== 'OK' && h.status !== 'WARNING') throw new Error(`ledger health ${h.status}`);
      break;
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
  console.log(`ok ${cmd} ${arg}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
