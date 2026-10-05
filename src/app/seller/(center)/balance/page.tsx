import { CircleHelp } from 'lucide-react';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { db } from '@/server/db/client';
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
  const cards = [
    { label: 'الرصيد المعلق', value: b.pending, tone: 'border-amber-300 bg-amber-50', def: 'صافي مبيعاتك (بعد العمولة) لطلبات تم دفعها ولم يؤكد العميل استلامها بعد، أو عليها نزاع/تجميد إداري.' },
    { label: 'الرصيد المتاح', value: b.available, tone: 'border-emerald-300 bg-emerald-50', def: 'صافي مبيعات الطلبات التي أكد العملاء استلامها، مطروحاً منها المستردات والتسويات وطلبات السحب. يمكنك سحبه الآن.' },
    { label: 'قيد السحب', value: b.reserved, tone: 'border-brand-200 bg-brand-50', def: 'مبالغ محجوزة لطلبات سحب قيد المراجعة أو التنفيذ. تعود للمتاح إذا رُفض الطلب أو أُلغي.' },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="الرصيد" actions={<LinkButton href="/seller/withdrawals">طلب سحب</LinkButton>} />
      <div className="grid gap-4 md:grid-cols-3">
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
          <li>العميل يدفع لاضمن ويتم التحقق من الدفع ← يُضاف صافي الطلب لرصيدك <b>المعلق</b>.</li>
          <li>تشحن الطلب وترفع البوليصة (لا يغير الرصيد).</li>
          <li>العميل يؤكد الاستلام ← يتحول المبلغ فوراً إلى رصيدك <b>المتاح</b> (ما لم يكن عليه نزاع).</li>
          <li>تطلب السحب أو يتم إدراجك في التسوية الدورية ← يحوّل فريق اضمن المبلغ لوسيلة السحب المعتمدة.</li>
        </ol>
      </div>
    </div>
  );
}
