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

/** Enum literals as bound parameters (L7): still validated, but nothing is pasted into SQL text. */
export function inList(values: readonly string[]): SQL {
  for (const v of values) if (!/^[A-Z0-9_]+$/.test(v)) throw new Error(`unsafe enum literal ${v}`);
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

/** CHECK (col IN (...)) generated from the same constant arrays the state machines use. */
export function enumCheck(name: string, column: AnyPgColumn, values: readonly string[]) {
  return check(name, sql`${column} in (${inList(values)})`);
}
