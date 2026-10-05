import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { auditLogs, dealInvitations, disputes, riskFlags, statusHistory } from '@/server/db/schema';
import { dealHoldAction } from '@/app/_actions/admin';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Textarea } from '@/ui/form';
import { dealGraph, deliveryOtpEvents } from '@/server/modules/deals/service';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { Breadcrumbs, DefinitionList, PageHeader, Timeline } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';

export default async function AdminDeal(props: PageProps<'/admin/deals/[id]'>) {
  const { actor, allowed } = await adminWith('deals.view');
  if (!allowed) return <Forbidden />;
  let g;
  try {
    g = await dealGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const d = g.deal;
  const invites = await db.select().from(dealInvitations).where(eq(dealInvitations.dealId, d.id)).orderBy(asc(dealInvitations.createdAt));
  const disp = await db.select().from(disputes).where(eq(disputes.dealId, d.id));
  const history = await db.select().from(statusHistory).where(eq(statusHistory.entityId, d.id)).orderBy(asc(statusHistory.createdAt));
  // Handover evidence: issuance / expiry / regeneration / failures / verification. The code itself is never shown.
  const otps = await deliveryOtpEvents(d.id);
  const otpAudit = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, d.id), inArray(auditLogs.action, ['deal.shipped', 'deal.delivery_otp_issued', 'deal.delivery_otp_regenerated', 'deal.delivery_otp_expired', 'deal.delivery_otp_failed', 'deal.delivery_otp_verified', 'deal.delivery_conflict', 'deal.delivery_exception', 'deal.receipt_confirmed', 'deal.hold_set', 'deal.hold_released'])))
    .orderBy(desc(auditLogs.createdAt));
  const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'external_deal'), eq(riskFlags.entityId, d.id)));
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الصفقات', href: '/admin/deals' }, { label: `#${d.number}` }]} />} title={`صفقة #${d.number}: ${d.title}`} description={`المشتري: ${g.buyerName}`} actions={<StatusChip status={d.status === 'DELIVERED' ? 'DEAL_SHIPPED' : d.status} />} />
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'البائع (بيانات مؤكدة)', value: d.sellerFullName ? `${d.sellerFullName} · ${d.sellerVerifiedPhone ?? ''} ${d.sellerContactEmail ?? ''}` : 'لم ينضم بعد' },
          { label: 'تلميحات المشتري عن البائع (غير مؤكدة)', value: d.sellerName || d.sellerPhone || d.sellerEmail ? `${d.sellerName ?? ''} ${d.sellerPhone ?? ''} ${d.sellerEmail ?? ''}` : '—' },
          { label: 'عنوان المشتري', value: g.buyerLocation ? `${g.buyerLocation.city}، ${g.buyerLocation.street}${g.buyerLocation.building ? ` · عمارة ${g.buyerLocation.building}` : ''}${g.buyerLocation.landmark ? ` · ${g.buyerLocation.landmark}` : ''}${g.buyerLocation.gps ? ` · موقع: ${g.buyerLocation.gps.lat}, ${g.buyerLocation.gps.lng}` : ''}` : '—' },
          { label: 'عنوان البائع', value: g.sellerLocation ? `${g.sellerLocation.city}، ${g.sellerLocation.street}${g.sellerLocation.building ? ` · عمارة ${g.sellerLocation.building}` : ''}${g.sellerLocation.gps ? ` · موقع: ${g.sellerLocation.gps.lat}, ${g.sellerLocation.gps.lng}` : ''}` : '—' },
          { label: 'الكمية / الحالة', value: `${d.quantity} · ${d.condition ?? '—'}` },
          { label: 'إجمالي السعر', value: d.totalAmount != null ? formatEGP(d.totalAmount) : '—' },
          { label: 'رسوم الحماية', value: `${formatEGP(d.feeAmount)} (${(d.feeBps / 100).toFixed(2)}%) يتحملها ${d.feePayer === 'BUYER' ? 'المشتري' : 'البائع'}` },
          { label: 'يدفع المشتري', value: d.buyerPays != null ? formatEGP(d.buyerPays) : '—' },
          { label: 'يستلم البائع', value: d.sellerReceives != null ? formatEGP(d.sellerReceives) : '—' },
          { label: 'التسليم', value: `${d.deliveryMethod ?? '—'} · قبل ${formatDate(d.deliveryDeadline)} · فحص ${d.inspectionDays} يوم` },
          { label: 'حساب صرف البائع', value: d.sellerPayoutMasked ? `${label('payoutType', d.sellerPayoutType)} ${d.sellerPayoutMasked}` : '—' },
          { label: 'شروط إضافية', value: d.customTerms ?? '—' },
          { label: 'رابط المصدر', value: d.sourceUrl ? <span className="ltr break-all">{d.sourceUrl}</span> : '—' },
          { label: 'الدفع', value: g.payment ? <Link className="text-brand-700" href={`/admin/payments/${g.payment.id}`}><StatusChip status={g.payment.status} /></Link> : '—' },
          { label: 'المستحق للبائع', value: g.payout ? <span>{formatEGP(g.payout.amount)} <StatusChip status={g.payout.status} /> {g.payout.paidReference && `· ${g.payout.paidReference}`} {g.payout.status === 'PENDING' && <Link className="text-brand-700" href="/admin/refunds?tab=deals">صرف</Link>}</span> : '—' },
        ]} />
        {d.deliveryNote && <p className="mt-3 rounded bg-page p-3 text-sm">ملاحظة التسليم: {d.deliveryNote}</p>}
        {g.evidence.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{g.evidence.map((e) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="size-20 overflow-hidden rounded-lg border border-line" title={e.kind}><img src={`/api/files/${e.fileId}`} alt={e.kind} className="size-full object-cover" /></a>)}</div>}
      </section>
      {(d.deliveryConflictAt || flags.some((f) => f.status === 'OPEN')) && (
        <Alert tone="danger" title={d.deliveryConflictAt ? 'تعارض في التسليم (DELIVERY_CONFLICT)' : 'مراجعة تسليم'}>
          {flags.map((f) => <p key={f.id}><Badge tone="danger">{f.code}</Badge> {f.note} · {formatDate(f.createdAt, true)} · <StatusChip status={f.status} /></p>)}
          <p className="mt-1 text-xs">رمز الاستلام دليل على التسليم وليس حكمًا تلقائيًا. المبلغ محجوز لحين قرار النزاع.</p>
        </Alert>
      )}
      <section className="card space-y-3 p-5" data-testid="admin-handover">
        <h2 className="font-bold">التسليم ورمز الاستلام</h2>
        <DefinitionList items={[
          { label: 'محاولة التسليم', value: String(d.deliveryAttempt) },
          { label: 'تم التحقق من التسليم', value: d.handoverVerifiedAt ? formatDate(d.handoverVerifiedAt, true) : 'لا' },
          { label: 'تأكيد المشتري للمطابقة', value: d.buyerConfirmedAt ? formatDate(d.buyerConfirmedAt, true) : 'لا' },
          { label: 'إيقاف الصرف (Operations hold)', value: d.financialHold ? <Badge tone="danger">موقوف</Badge> : 'لا' },
        ]} />
        {otps.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="text-muted"><th className="text-start">الإصدار</th><th className="text-start">الانتهاء</th><th className="text-start">المحاولات</th><th className="text-start">الحالة</th></tr></thead>
            <tbody>{otps.map((o) => <tr key={o.id}><td>{formatDate(o.createdAt, true)}</td><td>{formatDate(o.expiresAt, true)}</td><td>{o.attempts}/{o.maxAttempts}{o.lastAttemptAt ? ` · آخر محاولة ${formatDate(o.lastAttemptAt, true)}` : ''}</td><td>{o.usedAt ? `تم التحقق ${formatDate(o.usedAt, true)}` : o.invalidatedAt ? `غير صالح: ${o.invalidReason}` : 'صالح'}</td></tr>)}</tbody>
          </table>
        )}
        <p className="text-xs text-muted">رموز الاستلام لا تُخزَّن كنص صريح ولا تُعرض هنا.</p>
        {otpAudit.length > 0 && <Timeline items={otpAudit.map((a) => ({ title: a.action, time: formatDate(a.createdAt, true), body: a.newValues ? JSON.stringify(a.newValues) : a.reason }))} />}
        <ActionForm action={dealHoldAction} className="space-y-2 border-t border-line pt-3">
          <input type="hidden" name="dealId" value={d.id} />
          <input type="hidden" name="back" value={`/admin/deals/${d.id}`} />
          <input type="hidden" name="hold" value={d.financialHold ? '0' : '1'} />
          <Field label="سبب الإجراء (يتطلب تأكيد 2FA حديث)" htmlFor="hold-reason" required><Textarea id="hold-reason" name="reason" rows={2} required minLength={3} /></Field>
          <SubmitButton variant={d.financialHold ? 'outline' : 'danger'} size="sm">{d.financialHold ? 'رفع إيقاف الصرف' : 'إيقاف الصرف لحين المراجعة'}</SubmitButton>
        </ActionForm>
      </section>
      {disp.length > 0 && <section className="card p-5"><h2 className="mb-2 font-bold">النزاعات</h2>{disp.map((x) => <Link key={x.id} href={`/admin/disputes/${x.id}`} className="block text-brand-700">نزاع #{x.number} <StatusChip status={x.status} /></Link>)}</section>}
      <section className="card p-5">
        <h2 className="mb-2 font-bold">الدعوات</h2>
        <ul className="text-sm">{invites.map((i) => <li key={i.id}><StatusChip status={i.status} /> أُنشئت {formatDate(i.createdAt, true)} · تنتهي {formatDate(i.expiresAt, true)} {i.rejectReason && `· سبب الرفض: ${i.rejectReason}`}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">روابط الدعوة لا تُخزَّن كنص صريح (تُحفظ بصمة SHA-256 فقط) ولا يمكن عرضها هنا.</p>
      </section>
      <section className="card p-5"><h2 className="mb-2 font-bold">سجل الحالات</h2><Timeline items={history.map((h) => ({ title: `${h.fromStatus ?? '∅'} ← ${h.toStatus}`, time: `${formatDate(h.createdAt, true)} · ${h.actorType}`, body: h.reason }))} /></section>
    </div>
  );
}
