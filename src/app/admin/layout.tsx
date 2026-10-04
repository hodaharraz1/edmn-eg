import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'لوحة الإدارة', template: '%s | إدارة اضمن' }, robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-slate-100">{children}</div>;
}
