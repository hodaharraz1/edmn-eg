import { Landmark } from 'lucide-react';
import { archiveReceivingDestinationAction, submitReceivingDestinationAction } from '@/app/_actions/identity';
import { requireCustomer } from '@/server/web/session';
import { DESTINATION_STATUS_LABELS, myReceivingDestinations } from '@/server/modules/identity/receiving';
import { identityStatus } from '@/server/modules/identity/service';
import { db } from '@/server/db/client';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';
import { Field, Input, Select } from '@/ui/form';
import Link from '@/ui/link';

export const metadata = { title: 'بيانات استلام الأموال' };

export default async function ReceivingPage(props: PageProps<'/account/receiving'>) {
  const actor = await requireCustomer('/account/receiving');
  const sp = await props.searchParams;
  const list = await myReceivingDestinations(actor);
  const idStatus = await identityStatus(db, actor.userId!);
  const replacing = list.find((d) => d.id === sp.replace);
  const visible = list.filter((d) => d.status !== 'ARCHIVED');
  return (
    <div className="space-y-5">
      <PageHeader title="بيانات استلام الأموال" description="الحساب البنكي أو المحفظة اللي نرجّعلك عليها أي مبلغ مستحق لك (زي الاسترداد) لما يتعذر الرجوع لنفس وسيلة الدفع الأصلية. دي مش محفظة على اضمن: مفيش رصيد ولا إيداع ولا سحب." />
      {idStatus !== 'APPROVED' && <Alert tone="warning" action={<Link className="text-brand-700 underline" href="/account/identity">التحقق من الهوية</Link>}>البيانات تتراجع وتتعتمد بعد التحقق من هويتك، وصاحب الحساب لازم يكون أنت.</Alert>}
      {visible.length === 0 ? <EmptyState icon={Landmark} title="مفيش بيانات استلام محفوظة" description="مش لازم تضيف حاجة إلا لو احتجنا نرجّعلك مبلغ ووسيلة الدفع الأصلية مش متاحة." /> : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="receiving-list">
          {visible.map((d) => (
            <li key={d.id} className="card space-y-1 p-4 text-sm">
              <p className="flex items-center justify-between gap-2 font-semibold">{d.type === 'BANK_ACCOUNT' ? 'حساب بنكي' : 'محفظة موبايل'} <Badge tone={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'}>{DESTINATION_STATUS_LABELS[d.status]}</Badge></p>
              <p className="ltr text-muted">{d.maskedLabel}</p>
              <p>باسم: {d.holderName}</p>
              {d.reviewReason && d.status !== 'APPROVED' && <p className="text-amber-800">ملاحظة المراجعة: {d.reviewReason}</p>}
              <p className="text-xs text-muted">أُضيفت {formatDate(d.createdAt, true)} · نسخة {d.version}</p>
              <div className="flex gap-3 pt-1 text-xs">
                <a className="text-brand-700 hover:underline" href={`/account/receiving?replace=${d.id}`}>تعديل (نسخة جديدة تتراجع)</a>
                <ActionForm action={archiveReceivingDestinationAction}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="ghost" size="sm" className="h-auto px-0 text-xs text-red-700">أرشفة</SubmitButton></ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
      <section className="grid gap-4 lg:grid-cols-2">
        <ActionForm action={submitReceivingDestinationAction} className="card space-y-3 p-5" resetOnSuccess data-testid="receiving-wallet-form">
          <h2 className="font-bold">{replacing ? 'نسخة جديدة — ' : ''}محفظة موبايل</h2>
          <input type="hidden" name="type" value="MOBILE_WALLET" />{replacing && <input type="hidden" name="replacesId" value={replacing.id} />}
          <Field label="اسم صاحب المحفظة (زي البطاقة)" required><Input name="holderName" required minLength={6} /></Field>
          <Field label="مزود المحفظة" required><Select name="walletProvider" required defaultValue="فودافون كاش"><option>فودافون كاش</option><option>اتصالات كاش</option><option>أورنج كاش</option><option>وي باي</option></Select></Field>
          <Field label="رقم المحفظة" required><Input name="walletNumber" required inputMode="tel" className="ltr" /></Field>
          <SubmitButton>حفظ للمراجعة</SubmitButton>
        </ActionForm>
        <ActionForm action={submitReceivingDestinationAction} className="card space-y-3 p-5" resetOnSuccess data-testid="receiving-bank-form">
          <h2 className="font-bold">{replacing ? 'نسخة جديدة — ' : ''}حساب بنكي</h2>
          <input type="hidden" name="type" value="BANK_ACCOUNT" />{replacing && <input type="hidden" name="replacesId" value={replacing.id} />}
          <Field label="اسم صاحب الحساب (زي البطاقة)" required><Input name="holderName" required minLength={6} /></Field>
          <Field label="البنك" required><Input name="bankName" required /></Field>
          <Field label="IBAN" hint="EG + 27 رقم"><Input name="iban" className="ltr" /></Field>
          <Field label="أو رقم الحساب"><Input name="accountNumber" inputMode="numeric" className="ltr" /></Field>
          <SubmitButton>حفظ للمراجعة</SubmitButton>
        </ActionForm>
      </section>
      <p className="text-xs text-muted">أي تعديل بيعمل نسخة جديدة لازم تتراجع قبل استخدامها، والنسخة القديمة بتتأرشف. البيانات الكاملة مش بتظهر هنا ولا لأي مستخدم تاني.</p>
    </div>
  );
}
