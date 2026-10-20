import journal from '../../../drizzle/meta/_journal.json';

/** Migrations shipped with this build (bundled at build time, so readiness can compare with the database). */
export const EXPECTED_MIGRATIONS: number = (journal as { entries: unknown[] }).entries.length;
export const LATEST_MIGRATION: string = ((journal as { entries: { tag: string }[] }).entries.at(-1)?.tag ?? '') as string;
