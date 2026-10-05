import { q } from './helpers';

/**
 * Keep automated-test fixtures out of the public marketplace.
 * Every account the suite creates uses an `@e2e.local` email. After a run (local or against staging)
 * their sellers are suspended and their products archived, so storefront, search and store lists show
 * only presentation/pilot data. Orders, payments and ledger history are left untouched.
 */
export default async function globalTeardown() {
  const owned = `select s.id from sellers s join users u on u.id = s.owner_user_id where u.email like '%@e2e.local'`;
  await q(`update products set status = 'ARCHIVED', updated_at = now() where seller_id in (${owned}) and status <> 'ARCHIVED'`);
  await q(`update sellers set status = 'SUSPENDED', updated_at = now() where id in (${owned}) and status <> 'SUSPENDED'`);
}
