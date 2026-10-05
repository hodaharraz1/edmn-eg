import { sql } from 'drizzle-orm';
import { LogOut, Menu } from 'lucide-react';
import { adminLogoutAction } from '@/app/_actions/admin-auth';
import { AdminNav, type NavGroup } from '@/app/_components/admin-nav';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { getAdminSession, requireAdmin } from '@/server/web/session';
import type { Permission } from '@/server/rbac/permissions';
import { Drawer } from '@/ui/client';
import { Logo } from '@/ui/logo';

type Item = { href: string; label: string; perm: Permission | Permission[]; badgeKey?: string };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'القيادة', items: [{ href: '/admin', label: 'اللوحة التنفيذية', perm: 'dashboard.view' }] },
  {
    title: 'العملاء',
    items: [{ href: '/admin/customers', label: 'المستخدمون وملف 360°', perm: 'customers.view' }],
  },
  {
    title: 'السوق',
    items: [
      { href: '/admin/sellers', label: 'البائعون', perm: 'sellers.view' },
      { href: '/admin/seller-verification', label: 'التحقق من البائعين', perm: 'sellers.review', badgeKey: 'sellers' },
      { href: '/admin/products', label: 'المنتجات', perm: 'products.view' },
      { href: '/admin/moderation', label: 'مراجعة المنتجات', perm: 'products.moderate', badgeKey: 'products' },
      { href: '/admin/categories', label: 'التصنيفات والعمولات', perm: 'catalog.manage' },
      { href: '/admin/brands', label: 'العلامات التجارية', perm: 'catalog.manage' },
      { href: '/admin/attributes', label: 'السمات', perm: 'catalog.manage' },
      { href: '/admin/inventory', label: 'المخزون', perm: 'products.view' },
      { href: '/admin/policy', label: 'المنتجات المحظورة', perm: 'policy.manage' },
      { href: '/admin/orders', label: 'الطلبات', perm: 'orders.view' },
      { href: '/admin/shipping', label: 'أدلة الشحن', perm: 'shipping.view' },
      { href: '/admin/returns', label: 'المرتجعات', perm: 'returns.manage' },
      { href: '/admin/reviews', label: 'التقييمات', perm: 'reviews.moderate' },
    ],
  },
  {
    title: 'الصفقات المحمية',
    items: [
      { href: '/admin/deals', label: 'الصفقات الخارجية', perm: 'deals.view' },
      { href: '/admin/disputes', label: 'النزاعات', perm: 'disputes.manage', badgeKey: 'disputes' },
    ],
  },
  {
    title: 'المالية',
    items: [
      { href: '/admin/payments', label: 'التحقق من المدفوعات اليدوية', perm: 'payments.view', badgeKey: 'payments' },
      { href: '/admin/transactions', label: 'المعاملات', perm: ['finance.view', 'payments.view'] },
      { href: '/admin/balances', label: 'أرصدة البائعين', perm: 'finance.view' },
      { href: '/admin/withdrawals', label: 'السحوبات', perm: 'withdrawals.view', badgeKey: 'withdrawals' },
      { href: '/admin/settlements', label: 'التسويات', perm: ['settlements.manage', 'finance.view'] },
      { href: '/admin/refunds', label: 'المستردات والمستحقات', perm: ['refunds.pay', 'deals.payout', 'finance.view'], badgeKey: 'refunds' },
      { href: '/admin/commissions', label: 'العمولات', perm: 'commissions.manage' },
      { href: '/admin/ledger', label: 'دفتر القيود المالي', perm: 'finance.view' },
    ],
  },
  {
    title: 'العمليات',
    items: [
      { href: '/admin/approvals', label: 'مركز الموافقات', perm: 'dashboard.view', badgeKey: 'approvals' },
      { href: '/admin/notifications', label: 'الإشعارات', perm: 'notifications.manage' },
      { href: '/admin/support', label: 'الدعم الفني', perm: 'support.manage', badgeKey: 'tickets' },
      { href: '/admin/reports', label: 'التقارير والتصدير', perm: 'reports.view' },
    ],
  },
  {
    title: 'المخاطر والأمان',
    items: [
      { href: '/admin/audit', label: 'سجل التدقيق', perm: 'audit.view' },
      { href: '/admin/risk', label: 'مؤشرات المخاطر', perm: ['audit.view', 'finance.view'] },
    ],
  },
  {
    title: 'المحتوى',
    items: [
      { href: '/admin/cms', label: 'محتوى الصفحة الرئيسية', perm: 'cms.manage' },
      { href: '/admin/cms?type=BANNER', label: 'البانرات', perm: 'cms.manage' },
      { href: '/admin/cms?type=FEATURED_CATEGORIES', label: 'التصنيفات المميزة', perm: 'cms.manage' },
      { href: '/admin/cms?type=PRODUCT_RAIL', label: 'المنتجات المميزة', perm: 'cms.manage' },
      { href: '/admin/cms?type=FEATURED_SELLERS', label: 'المتاجر المميزة', perm: 'cms.manage' },
      { href: '/admin/cms?tab=pages', label: 'الصفحات الثابتة', perm: 'cms.manage' },
    ],
  },
  {
    title: 'النظام',
    items: [
      { href: '/admin/roles', label: 'المشرفون', perm: 'roles.manage' },
      { href: '/admin/roles?tab=matrix', label: 'الأدوار والصلاحيات', perm: 'roles.manage' },
      { href: '/admin/payment-settings', label: 'طرق وحسابات الدفع', perm: 'payments.destinations.manage' },
      { href: '/admin/legal', label: 'النصوص القانونية', perm: 'legal.manage' },
      { href: '/admin/settings', label: 'إعدادات النظام', perm: 'settings.manage' },
    ],
  },
];

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdmin();
  const s = (await getAdminSession())!;
  const r = await db.execute<Record<string, string>>(sql`select
    (select count(*) from sellers where status = 'PENDING_REVIEW') sellers,
    (select count(*) from products where status in ('SUBMITTED','UNDER_REVIEW')) + (select count(*) from product_revisions where status = 'SUBMITTED') products,
    (select count(*) from payments where status in ('PAYMENT_SUBMITTED','UNDER_REVIEW')) payments,
    (select count(*) from disputes where status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')) disputes,
    (select count(*) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) withdrawals,
    (select count(*) from refunds where status = 'PENDING') + (select count(*) from deal_payouts where status = 'PENDING') refunds,
    (select count(*) from support_tickets where status in ('OPEN','ESCALATED')) tickets,
    (select count(*) from ledger_adjustments where status = 'PENDING_APPROVAL') adjustments`);
  const counts: Record<string, string> = { ...r.rows[0] };
  counts.approvals = String(['sellers', 'products', 'payments', 'withdrawals', 'refunds', 'adjustments'].reduce((n, k) => n + Number(counts[k]), 0));
  const groups: NavGroup[] = GROUPS.map((g) => ({
    title: g.title,
    items: g.items
      .filter((i) => (Array.isArray(i.perm) ? i.perm.some((p) => hasPermission(actor, p)) : hasPermission(actor, i.perm)))
      .map((i) => ({ href: i.href, label: i.label, badge: i.badgeKey ? Number(counts[i.badgeKey]) : undefined })),
  })).filter((g) => g.items.length);
  return (
    <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden h-dvh overflow-y-auto bg-slate-900 p-4 lg:sticky lg:top-0 lg:block">
        <div className="mb-5 space-y-1 text-white">
          <Logo href="/admin" label="مركز عمليات اضمن" />
          <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-sky-300" dir="ltr">EDMN Operations &amp; Control Center</p>
        </div>
        <AdminNav groups={groups} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4">
          <Drawer title="القائمة" trigger={<button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-page lg:hidden" aria-label="القائمة"><Menu className="size-5" /></button>}>
            <div className="rounded-xl bg-slate-900 p-2"><AdminNav groups={groups} /></div>
          </Drawer>
          <span className="font-bold">مركز العمليات والتحكم</span>
          <span className="hidden rounded bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-sky-300 sm:inline" dir="ltr">EDMN OPS</span>
          <span className="flex-1" />
          <span className="hidden text-sm text-muted sm:inline">{s.user.fullName}</span>
          <form action={adminLogoutAction}><button className="flex items-center gap-1 text-sm text-red-700"><LogOut className="size-4" /> خروج</button></form>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
