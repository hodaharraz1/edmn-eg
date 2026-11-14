/**
 * Child-process probe for tests/integration/deployment-safety.test.ts: tries a query and a transaction through the
 * application's own database client and prints CONNECTED / REFUSED. Run with the environment under test.
 */
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../../src/server/db/client';

async function main() {
  try {
    await db.execute(sql`select 1`);
    console.log('QUERY-CONNECTED');
  } catch (e) {
    const err = e as Error & { cause?: Error };
    console.log('QUERY-REFUSED', err.cause?.message ?? err.message);
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
    });
    console.log('TX-CONNECTED');
  } catch (e) {
    console.log('TX-REFUSED', (e as Error).message);
  }
  await closeDb();
}

void main();
