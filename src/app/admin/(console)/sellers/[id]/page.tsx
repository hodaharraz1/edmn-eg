import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { revealNationalIdAction, riskFlagAction, sellerDecisionAction, verifyPayoutAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { RevealNationalId } from '@/app/_components/reveal-id';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, disputes, governorates, products, returns, riskFlags, sellerDocuments, sellerOrders, sellerPayoutMethods, sellerShippingRates, sellers, stores, supportTickets, users, withdrawalRequests } from '@/server/db/schema';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { applicationChecklist } from '@/server/modules/sellers/service';
import { rangeFromPreset, sellerDashboard } from '@/server/modules/reports/service';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Stars } from '@/ui/commerce';
import { Breadcrumbs, DataTable, DefinitionList, PageHeader, StatCard, Tabs } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { marketHref } from '@/lib/market-url';
import { Field, Select, Textarea, Input } from '@/ui/form';

export default async function Seller360(props: PageProps<'/admin/sellers/[id]'>) {
  const { actor, allowed } = await adminWith('sellers.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === 'string' ? sp.tab : 'overview';
  const [row] = await db.select({ s: sellers, owner: users }).from(sellers).innerJoin(users, eq(users.id, sellers.ownerUserId)).where(eq(sellers.id, id));
  if (!row) notFound();
  const s = row.s;
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, s.id));
  const [gov] = s.governorateId ? await db.select().from(governorates).where(eq(governorates.id, s.governorateId)) : [];
  const canDocs = hasPermission(actor, 'sellers.documents.view');
  const base = `/admin/sellers/${s.id}`;
  const [balances, metrics, checklist] = await Promise.all([sellerBalances(db, s.id), sellerDashboard(s.id, rangeFromPreset('365d')), applicationChecklist(db, s)]);
  const decisions: [string, string][] = s.status === 'PENDING_REVIEW' ? [['APPROVE', 'موافقة'], ['REQUEST_MORE_INFORMATION', 'طلب معلومات'], ['REJECT', 'رفض']] : s.status === 'APPROVED' ? [['RESTRICT', 'تقييد'], ['SUSPEND', 'إيقاف']] : s.status === 'RESTRICTED' || s.status === 'SUSPENDED' ? [['REINSTATE', 'إعادة تفعيل'], ...(s.status === 'RESTRICTED' ? [['SUSPEND', 'إيقاف']] : [['RESTRICT', 'تقييد']]) as [string, string][]] : s.status === 'MORE_INFO_REQUIRED' ? [['REJECT', 'رفض']] : [];

  return (
    <div className="space-y-5">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'البائعون', href: '/admin/sellers' }, { label: store?.name ?? s.legalName ?? '' }]} />} title={store?.name ?? s.legalName ?? 'بائع'} description={`${label('sellerType', s.type)} · انضم ${formatDate(s.createdAt)}`} actions={<><StatusChip status={s.status} />{store && s.status === 'APPROVED' && <Link href={marketHref(`/store/${store.slug}`)} target="_blank" className="text-sm text-brand-700 underline">المتجر العام</Link>}</>} />
      {s.statusReason && <Alert tone="info">آخر سبب مسجل: {s.statusReason}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="المبيعات (12 شهر)" value={formatEGP(metrics.gross)} />
        <StatCard label="العمولات" value={formatEGP(metrics.commission)} tone="success" />
        <StatCard label="معلق" value={formatEGP(balances.pending)} tone="warning" />
        <StatCard label="متاح" value={formatEGP(balances.available)} tone="success" />
        <StatCard label="قيد السحب" value={formatEGP(balances.reserved)} tone="neutral" />
      </div>
      <Tabs active={tab} tabs={[
        { key: 'overview', label: 'الهوية والتحقق', href: base },
        { key: 'commerce', label: 'المنتجات والطلبات', href: `${base}?tab=commerce` },
        { key: 'finance', label: 'المالية والسحب', href: `${base}?tab=finance` },
        { key: 'health', label: 'الأداء والمخاطر', href: `${base}?tab=health` },
        { key: 'audit', label: 'السجل', href: `${base}?tab=audit` },
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'commerce' && <Commerce />}
      {tab === 'finance' && <Finance />}
      {tab === 'health' && <Health />}
      {tab === 'audit' && <Audit />}
    </div>
  );

  async function Overview() {
    const docs = canDocs ? await db.select().from(sellerDocuments).where(eq(sellerDocuments.sellerId, s.id)).orderBy(desc(sellerDocuments.createdAt)) : [];
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="card space-y-3 p-5">
            <h2 className="font-bold">الهوية</h2>
            <DefinitionList items={[
              { label: 'الاسم القانوني', value: s.legalName },
              { label: 'الرقم القومي', value: s.nationalIdLast4 ? `•••••••••• ${s.nationalIdLast4}` : '—' },
              { label: 'الموبايل', value: <span className="ltr">{s.mobile} {s.mobileVerifiedAt ? '✓' : ''}</span> },
              { label: 'البريد', value: <span className="ltr">{s.email}</span> },
              { label: 'العنوان', value: `${s.addressLine ?? ''}، ${s.city ?? ''}، ${gov?.nameAr ?? ''}` },
              { label: 'اتفاقية البائع', value: s.agreementVersion ? `إصدار ${s.agreementVersion} · ${formatDate(s.agreementAcceptedAt, true)}` : '—' },
              ...(s.type === 'BUSINESS' ? [{ label: 'النشاط', value: s.businessLegalName }, { label: 'السجل التجاري', value: s.commercialRegistrationNo }, { label: 'التسجيل الضريبي', value: s.taxRegistrationNo }, { label: 'الممثل القانوني', value: s.authorizedRepresentative }] : []),
            ]} />
            {canDocs && s.nationalIdEnc && <RevealNationalId action={revealNationalIdAction} sellerId={s.id} />}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 font-bold">الوثائق {!canDocs && <Badge>مخفية — تتطلب صلاحية</Badge>}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {docs.map((d) => (
                <li key={d.id} className={`rounded-lg border p-3 text-sm ${d.supersededAt ? 'opacity-50' : 'border-line'}`}>
                  <p className="font-semibold">{label('docKind', d.kind)} {d.supersededAt && <Badge>مستبدلة</Badge>}</p>
                  <p className="text-xs text-muted">{formatDate(d.createdAt, true)} · <StatusChip status={d.status} /></p>
                  <a href={`/api/files/${d.fileId}`} target="_blank" className="text-xs text-brand-700 underline">عرض (يُسجل في التدقيق)</a>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-bold">المتجر</h2>
            {store ? <DefinitionList items={[{ label: 'الاسم', value: store.name }, { label: 'عنوان الإرجاع', value: store.returnAddress }, { label: 'الإرجاع الاختياري', value: store.acceptsVoluntaryReturns ? `${store.voluntaryReturnDays} يوم` : 'لا' }, { label: 'مدة التجهيز', value: `${store.defaultProcessingDays} يوم` }]} /> : '—'}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-2 font-bold">اكتمال الطلب</h2>
            <ul className="space-y-1 text-sm">{checklist.map((c) => <li key={c.key} className={c.ok ? 'text-emerald-700' : 'text-red-700'}>{c.ok ? '✓' : '✗'} {c.label}</li>)}</ul>
          </section>
          {decisions.length > 0 && hasPermission(actor, 'sellers.review') && (
            <ActionForm action={sellerDecisionAction} className="card space-y-3 p-5">
              <h2 className="font-bold">القرار</h2>
              <input type="hidden" name="sellerId" value={s.id} />
              <Field label="الإجراء" htmlFor="decision"><Select id="decision" name="decision">{decisions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <Field label="السبب (إلزامي لغير الموافقة)" htmlFor="reason"><Textarea id="reason" name="reason" rows={3} /></Field>
              <SubmitButton className="w-full">تسجيل القرار</SubmitButton>
            </ActionForm>
          )}
          <PayoutMethods />
        </aside>
      </div>
    );
  }

  async function PayoutMethods() {
    const pms = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.sellerId, s.id)).orderBy(desc(sellerPayoutMethods.createdAt));
    return (
      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-bold">وسائل السحب</h2>
        {s.payoutHoldUntil && s.payoutHoldUntil > new Date() && <Alert tone="warning">تعليق السحب حتى {formatDate(s.payoutHoldUntil, true)}</Alert>}
        {pms.map((m) => (
          <div key={m.id} className="rounded-lg border border-line p-2">
            <p>{label('payoutType', m.type)} · {m.maskedLabel} {m.isDefault && <Badge tone="brand">افتراضية</Badge>}</p>
            <p className="text-xs text-muted">{m.holderName} · {formatDate(m.createdAt, true)} · <StatusChip status={m.status} /></p>
            {m.status === 'PENDING_VERIFICATION' && s.status !== 'PENDING_REVIEW' && hasPermission(actor, 'sellers.payout.verify') && (
              <div className="mt-2 flex gap-2">
                <ActionForm action={verifyPayoutAction}><input type="hidden" name="payoutMethodId" value={m.id} /><input type="hidden" name="sellerId" value={s.id} /><input type="hidden" name="decision" value="approve" /><input type="hidden" name="back" value={`/admin/sellers/${s.id}`} /><SubmitButton size="sm" variant="success">اعتماد</SubmitButton></ActionForm>
                <ActionForm action={verifyPayoutAction} className="flex gap-1"><input type="hidden" name="payoutMethodId" value={m.id} /><input type="hidden" name="sellerId" value={s.id} /><input type="hidden" name="decision" value="reject" /><input type="hidden" name="back" value={`/admin/sellers/${s.id}`} /><input name="reason" required minLength={3} placeholder="سبب الرفض" aria-label="سبب رفض وسيلة السحب" className="h-8 rounded border border-line px-2 text-xs" /><SubmitButton size="sm" variant="outline">رفض</SubmitButton></ActionForm>
              </div>
            )}
          </div>
        ))}
      </section>
    );
  }

  async function Commerce() {
    const [prodStats, orderStats, rets, disp, rates] = await Promise.all([
      db.select({ status: products.status, n: sql<number>`count(*)::int` }).from(products).where(eq(products.sellerId, s.id)).groupBy(products.status),
      db.select({ so: sellerOrders }).from(sellerOrders).where(eq(sellerOrders.sellerId, s.id)).orderBy(desc(sellerOrders.createdAt)).limit(20),
      db.select().from(returns).where(eq(returns.sellerId, s.id)).orderBy(desc(returns.createdAt)).limit(10),
      db.select().from(disputes).where(eq(disputes.respondentSellerId, s.id)).orderBy(desc(disputes.createdAt)).limit(10),
      db.select({ r: sellerShippingRates, g: governorates.nameAr }).from(sellerShippingRates).innerJoin(governorates, eq(governorates.id, sellerShippingRates.governorateId)).where(and(eq(sellerShippingRates.sellerId, s.id), eq(sellerShippingRates.enabled, true))),
    ]);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">{prodStats.map((p) => <Link key={p.status} href={`/admin/products?seller=${s.id}&status=${p.status}`} className="card px-3 py-2 text-sm"><StatusChip status={p.status} /> {p.n}</Link>)}</div>
        <h3 className="font-bold">أحدث الطلبات</h3>
        <DataTable rows={orderStats} rowKey={(r) => r.so.id} columns={[{ key: 'o', header: 'الطلب', cell: (r) => <Link href={`/admin/orders/${r.so.orderId}`} className="text-brand-700 hover:underline">{r.so.suffix} · {formatDate(r.so.createdAt)}</Link> }, { key: 'g', header: 'الإجمالي', cell: (r) => formatEGP(r.so.grossTotal) }, { key: 'c', header: 'العمولة', cell: (r) => formatEGP(r.so.commissionTotal) }, { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.so.status} /> }]} />
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card p-4 text-sm"><h3 className="mb-2 font-bold">المرتجعات</h3>{rets.map((r) => <p key={r.id}>#{r.number} {label('returnReason', r.reason)} <StatusChip status={r.status} /></p>)}{!rets.length && <p className="text-muted">لا يوجد</p>}</section>
          <section className="card p-4 text-sm"><h3 className="mb-2 font-bold">النزاعات</h3>{disp.map((d) => <Link key={d.id} href={`/admin/disputes/${d.id}`} className="block text-brand-700">#{d.number} <StatusChip status={d.status} /></Link>)}{!disp.length && <p className="text-muted">لا يوجد</p>}</section>
        </div>
        <section className="card p-4 text-sm"><h3 className="mb-2 font-bold">الشحن ({rates.length} محافظة مفعلة)</h3><p className="text-muted">{rates.map((r) => `${r.g}: ${formatEGP(r.r.fee)}`).join(' · ')}</p></section>
      </div>
    );
  }

  async function Finance() {
    const wds = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, s.id)).orderBy(desc(withdrawalRequests.createdAt)).limit(30);
    return (
      <div className="space-y-4">
        <DataTable rows={wds} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'رقم', cell: (r) => <Link href={`/admin/withdrawals/${r.id}`} className="text-brand-700">#{r.number}</Link> }, { key: 'a', header: 'المبلغ', cell: (r) => formatEGP(r.amount) }, { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.createdAt) }, { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.status} /> }]} />
        <p className="text-sm"><Link href={`/admin/ledger?seller=${s.id}`} className="text-brand-700 underline">كشف القيود الكامل والتسويات</Link></p>
      </div>
    );
  }

  async function Health() {
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'seller'), eq(riskFlags.entityId, s.id))).orderBy(desc(riskFlags.createdAt));
    const tickets = await db.select().from(supportTickets).where(eq(supportTickets.sellerId, s.id)).orderBy(desc(supportTickets.createdAt)).limit(10);
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">مؤشرات الأداء (12 شهر)</h2>
          <p>التقييم: <Stars value={s.ratingAvg} count={s.ratingCount} /></p>
          <p>نسبة الإلغاء: {(metrics.cancellationRate * 100).toFixed(1)}% · المرتجعات: {(metrics.returnRate * 100).toFixed(1)}% · الشحن في الموعد: {metrics.onTimeRate === null ? '—' : `${Math.round(metrics.onTimeRate * 100)}%`}</p>
          <h3 className="pt-3 font-bold">تذاكر الدعم</h3>
          {tickets.map((t) => <Link key={t.id} href={`/admin/support/${t.id}`} className="block text-brand-700">#{t.number} {t.subject}</Link>)}
        </section>
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="font-bold">مؤشرات المخاطر</h2>
          {flags.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-line p-2">
              <span><Badge tone={f.status === 'OPEN' ? 'danger' : 'neutral'}>{f.severity}</Badge> {f.code} — {f.note}</span>
              {f.status === 'OPEN' && <ActionForm action={riskFlagAction}><input type="hidden" name="op" value="resolve" /><input type="hidden" name="flagId" value={f.id} /><input type="hidden" name="entityType" value="seller" /><input type="hidden" name="entityId" value={s.id} /><input type="hidden" name="back" value={`${base}?tab=health`} /><SubmitButton size="sm" variant="ghost">حل</SubmitButton></ActionForm>}
            </div>
          ))}
          <ActionForm action={riskFlagAction} className="grid gap-2">
            <input type="hidden" name="entityType" value="seller" /><input type="hidden" name="entityId" value={s.id} /><input type="hidden" name="back" value={`${base}?tab=health`} />
            <div className="grid grid-cols-2 gap-2"><Input name="code" placeholder="الكود" aria-label="الكود" /><Select name="severity" aria-label="الخطورة"><option>LOW</option><option>MEDIUM</option><option>HIGH</option></Select></div>
            <Textarea name="note" rows={2} placeholder="الملاحظة" aria-label="الملاحظة" />
            <SubmitButton size="sm" variant="outline">إضافة مؤشر</SubmitButton>
          </ActionForm>
        </section>
      </div>
    );
  }

  async function Audit() {
    const rows = await db.select({ a: auditLogs, actorName: users.fullName }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(and(eq(auditLogs.entityType, 'seller'), eq(auditLogs.entityId, s.id))).orderBy(desc(auditLogs.createdAt)).limit(100);
    return <DataTable rows={rows} rowKey={(r) => String(r.a.id)} columns={[{ key: 't', header: 'الوقت', cell: (r) => formatDate(r.a.createdAt, true) }, { key: 'a', header: 'الإجراء', cell: (r) => <code className="text-xs">{r.a.action}</code> }, { key: 'u', header: 'المنفذ', cell: (r) => `${r.actorName ?? '—'} (${r.a.actorType})` }, { key: 'r', header: 'السبب', cell: (r) => r.a.reason ?? '—' }]} />;
  }
}
