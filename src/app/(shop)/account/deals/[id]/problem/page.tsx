import { notFound, redirect } from 'next/navigation';
import { usedDisputeAction } from '@/app/_actions/used';
import { dealGraph } from '@/server/modules/deals/service';
import { isDomainError } from '@/server/core/errors';
import { snapshotsForDispute } from '@/server/modules/used/snapshots';
import { requireCustomer } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Field, Select, Textarea } from '@/ui/form';
import { ConditionDetails } from '@/app/_components/used';

export const metadata = { title: 'توجد مشكلة في المنتج' };
const OPENABLE = ['ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE'];

/**
 * «توجد مشكلة» for a documented used item: a structured reason from the category policy, a description and evidence.
 * It opens the EXISTING dispute (same hold rules); staff judge it against the frozen condition shown here.
 */
export default async function UsedProblem(props: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomer('/account/deals');
  const { id } = await props.params;
  let g;
  try {
    g = await dealGraph(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  if (g.role !== 'BUYER') notFound();
  const binding = await snapshotsForDispute({ dealId: id, sellerOrderId: null });
  const snap = binding[0]?.snapshot;
  if (!snap) redirect(`/account/disputes/new?deal=${id}`);
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'الصفقات المحمية', href: '/account/deals' }, { label: g.ref, href: `/account/deals/${id}` }, { label: 'توجد مشكلة' }]} />}
        title="توجد مشكلة في المنتج"
        description="فلوسك بتفضل محجوزة عند اضمن لحد ما الفريق يراجع النزاع ويقرر. المراجعة بتقارن المنتج بالحالة اللي اتجمّدت وقت الاتفاق."
      />
      {!OPENABLE.includes(g.deal.status) ? (
        <Alert tone="warning">مينفعش تفتح نزاع على الصفقة في حالتها دلوقتي.</Alert>
      ) : (
        <ActionForm action={usedDisputeAction} encType="multipart/form-data" className="card space-y-4 p-5" data-testid="used-problem-form">
          <input type="hidden" name="dealId" value={id} />
          <Field label="إيه المشكلة؟" htmlFor="reasonCode" required>
            <Select id="reasonCode" name="reasonCode" required defaultValue="">
              <option value="" disabled>— اختار السبب —</option>
              {snap.disputeReasons.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="اشرح المشكلة بالتفصيل" htmlFor="description" required hint="مثلاً: البطارية 70% مش 88% زي المذكور، أو رقم IMEI مختلف عن جواز المنتج.">
            <Textarea id="description" name="description" rows={4} required minLength={20} maxLength={4000} />
          </Field>
          <FileInput name="evidence" multiple label="صور أو فيديو قصير للمشكلة (لحد 8 ملفات)" />
          <SubmitButton variant="danger">افتح النزاع</SubmitButton>
        </ActionForm>
      )}
      <section className="card space-y-3 p-5">
        <h2 className="font-bold">الحالة المتفق عليها (المرجع)</h2>
        <ConditionDetails fields={snap.fields.map((f) => ({ code: f.code, group: f.group, label: f.label, display: f.display }))} defects={snap.defects} identifierMasked={snap.identifier?.masked ?? null} evidence={snap.evidence.map((e) => ({ slot: e.slot, label: e.label, fileId: e.fileId, private: true }))} showPrivate />
      </section>
    </div>
  );
}
