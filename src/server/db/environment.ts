import { eq, sql } from 'drizzle-orm';
import { deploymentContext } from '@/server/core/deploy-policy';
import type { DbOrTx } from './client';
import { deploymentEnvironment, DEPLOYMENT_ENVIRONMENTS } from './schema';

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

/**
 * Maps EDMN_ENVIRONMENT / NODE_ENV to the database marker (null = nothing to mark). A preview never marks anything
 * from environment variables: PREVIEW is written only by the explicit initialisation of an EMPTY database
 * (markPreviewDatabase), and a preview never adopts another marker either.
 */
export function environmentMarker(env: Record<string, string | undefined> = process.env): DeploymentEnvironment | null {
  if (deploymentContext(env) === 'PREVIEW') return null;
  const kind = (env.EDMN_ENVIRONMENT ?? '').toUpperCase();
  if ((DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(kind)) return kind as DeploymentEnvironment;
  if (env.NODE_ENV === 'test') return 'TEST';
  return null;
}

export async function databaseEnvironment(conn: DbOrTx): Promise<DeploymentEnvironment | null> {
  const [row] = await conn.select().from(deploymentEnvironment).where(eq(deploymentEnvironment.id, true));
  return row?.environment ?? null;
}

/**
 * Called by the migration runner. Marks an unmarked database with the deployment kind, and refuses to run
 * an application of another kind against a PRODUCTION database (or to promote a database that already
 * served as staging/development to production: a production database starts empty).
 */
export async function markDeploymentEnvironment(conn: DbOrTx, wanted: DeploymentEnvironment | null): Promise<DeploymentEnvironment | null> {
  const current = await databaseEnvironment(conn);
  if (current === 'PRODUCTION' && wanted !== 'PRODUCTION') {
    throw new Error(`This database is marked PRODUCTION; refusing to use it as ${wanted ?? 'an unmarked environment'}`);
  }
  if (wanted === 'PRODUCTION' && current && current !== 'PRODUCTION') {
    throw new Error(`This database was used as ${current}; a PRODUCTION deployment needs a fresh database`);
  }
  if (wanted === 'PREVIEW') throw new Error('PREVIEW is written only by scripts/preview-db-init.ts on an empty database');
  if (current === 'PREVIEW' && wanted) throw new Error(`This database is an isolated PREVIEW database; refusing to use it as ${wanted}`);
  if (!wanted || current === wanted) return current;
  if (wanted === 'PRODUCTION') {
    // A database that already holds demo/E2E accounts can never become production.
    const r = await conn.execute<{ n: string }>(sql`select count(*)::text n from users where lower(email) like '%.local'`);
    if (Number(r.rows[0]?.n ?? 0) > 0) throw new Error('Refusing to mark a database holding demo/test accounts as PRODUCTION');
  }
  await conn
    .insert(deploymentEnvironment)
    .values({ id: true, environment: wanted })
    .onConflictDoUpdate({ target: deploymentEnvironment.id, set: { environment: wanted, markedAt: new Date() } });
  return wanted;
}

/** Application-level twin of the DB triggers: demo/E2E seeding never touches a PRODUCTION database. */
export async function assertNotProductionDatabase(conn: DbOrTx, what: string) {
  if ((await databaseEnvironment(conn)) === 'PRODUCTION') throw new Error(`Refusing to ${what}: this database is marked PRODUCTION`);
}

/**
 * Marks a freshly migrated, otherwise EMPTY database as PREVIEW. The caller (scripts/preview-db-init.ts) proved the
 * database had no tables before migrating it; this re-checks that no business data exists. The database trigger
 * refuses re-marking a STAGING / PRODUCTION database (or a PREVIEW one) in any case.
 */
export async function markPreviewDatabase(conn: DbOrTx): Promise<void> {
  const current = await databaseEnvironment(conn);
  if (current && current !== 'PREVIEW') throw new Error(`refusing to mark a ${current} database as PREVIEW`);
  const r = await conn.execute<{ n: string }>(sql`select ((select count(*) from users) + (select count(*) from orders) + (select count(*) from external_deals))::text n`);
  if (Number(r.rows[0]?.n ?? 0) > 0) throw new Error('refusing to mark a database that already holds users, orders or deals as PREVIEW');
  await conn.insert(deploymentEnvironment).values({ id: true, environment: 'PREVIEW' }).onConflictDoNothing();
}
