import { sql, type SQL } from 'drizzle-orm';
import { bigint, check, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const ts = (name?: string) =>
  name ? timestamp(name, { withTimezone: true, mode: 'date' }) : timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => ts().notNull().defaultNow();
export const updatedAt = () =>
  ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Money in integer minor units (piasters). Never floating point. */
export const money = () => bigint({ mode: 'number' });

/**
 * Enum literals for CHECK constraints. These are DDL: drizzle-kit must see the literal values to write the
 * migration, so they cannot be bound parameters (that made every enum CHECK look changed). Safe by construction:
 * the values come from code constants and anything other than [A-Z0-9_] is refused before it reaches SQL.
 */
export function inList(values: readonly string[]): SQL {
  for (const v of values) if (!/^[A-Z0-9_]+$/.test(v)) throw new Error(`unsafe enum literal ${v}`);
  return sql.raw(values.map((v) => `'${v}'`).join(', '));
}

/** CHECK (col IN (...)) generated from the same constant arrays the state machines use. */
export function enumCheck(name: string, column: AnyPgColumn, values: readonly string[]) {
  return check(name, sql`${column} in (${inList(values)})`);
}
