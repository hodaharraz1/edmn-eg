import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = { title: { default: 'لوحة الإدارة', template: '%s | إدارة اضمن' }, robots: { index: false, follow: false } };

/**
 * Every admin page renders per request (Batch 2): the admin surface runs under a nonce-based CSP (set in
 * src/proxy.ts), and a nonce can only be applied to a dynamically rendered page.
 */
export default async function AdminRoot({ children }: { children: React.ReactNode }) {
  await connection();
  return <div className="min-h-dvh bg-slate-100">{children}</div>;
}
