import { CircleHelp } from 'lucide-react';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { db } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { requireSellerActor } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { SellerForbidden } from '@/app/_components/seller-forbidden';
import { PageHeader } from '@/ui/data';

export const metadata = { title: 'الرصيد' };

export default async function BalancePage() {
  const actor = await requireSellerActor('/seller/balance');
  if (!actor.sellerPermissions?.has('finance.view')) return <SellerForbidden />;
  const b = await sellerBalances(db, actor.sellerId!);
  const ent = await db.execute<{ s: string }>(sql`select coalesce(sum(l.credit - l.debit), 0)::text s from journal_lines l
    join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id join seller_orders so on so.id::text = e.source_id
    where a.code = 'SELLER_PENDING' and a.seller_id = ${actor.sellerId!} and so.status = 'DELIVERED' and so.funds_released_at is null`);
  const entitled = Number(ent.rows[0].s);
  const cards = [
    { label: 'الرصيد المعلق', value: b.pending - entitled, tone: 'border-amber-300 bg-amber-50', def: 'صافي مبيعاتك (بعد رسوم اضمن) لطلبات مدفوعة لسه ما اتسلمتش أو في مهلة رد المشتري أو عليها نزاع/تجميد.' },
    { label: 'مستحق وفي انتظار موافقة الإدارة', value: entitled, tone: 'border-sky-300 bg-sky-50', def: 'المشتري أكد الاستلام (أو انتهت مهلته بدون اعتراض). المبلغ لسه معلق ومش متاح للسحب لحد ما الإدارة توافق على الإتاحة.' },
    { label: 'متاح للسحب', value: b.available, tone: 'border-emerald-300 bg-emerald-50', def: 'المبالغ اللي الإدارة وافقت على إتاحتها، مطروحًا منها المستردات والتسويات والسحب. لو الرقم بالسالب فده مديونية لازم تتسوى قبل أي سحب.' },
    { label: 'محجوز لسحب معتمد', value: b.reserved, tone: 'border-brand-200 bg-brand-50', def: 'طلب السحب لا يحجز أي مبلغ. الحجز يتم فقط عند اعتماد الإدارة للطلب، ويرجع للمتاح لو اترفض.' },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="الرصيد" actions={<LinkButton href="/seller/withdrawals">طلب سحب</LinkButton>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl border p-5 ${c.tone}`}>
            <p className="text-sm">{c.label}</p>
            <p className="mt-1 text-2xl font-bold">{formatEGP(c.value)}</p>
            <p className="mt-3 flex gap-1.5 text-xs text-muted"><CircleHelp className="size-4 shrink-0" /> {c.def}</p>
          </div>
        ))}
      </div>
      <div className="card p-5 text-sm leading-7">
        <h2 className="mb-2 font-bold">كيف تصبح أرباحي متاحة؟</h2>
        <ol className="list-inside list-decimal">
          <li>العميل يدفع لاضمن والإدارة تتأكد من الدفع ← يُضاف صافي الطلب لرصيدك <b>المعلق</b>.</li>
          <li>تشحن الطلب وترفع البوليصة (لا يغير الرصيد).</li>
          <li>بعد ما شركة الشحن تأكد التسليم، ترفع <b>دليل التسليم خلال 24 ساعة</b>. كلامك لوحده مش دليل تسليم.</li>
          <li>المشتري عنده 24 ساعة يأكد الاستلام أو يبلّغ عن مشكلة. تأكيده أو انتهاء المهلة بدون اعتراض = <b>مستحق وفي انتظار موافقة الإدارة</b>.</li>
          <li>الإدارة توافق يدويًا على الإتاحة ← يتحول المبلغ لرصيدك <b>المتاح</b>.</li>
          <li>تطلب السحب ← الإدارة تعتمده وتحجز المبلغ ← يتم التحويل لوسيلة السحب المعتمدة (خطوة منفصلة).</li>
        </ol>
      </div>
    </div>
  );
}
