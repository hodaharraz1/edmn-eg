import { Wallet } from 'lucide-react';
import { SellerFinanceSummary } from '@/app/_components/seller-finance-summary';
import { db } from '@/server/db/client';
import { sellerFinancialView } from '@/server/modules/finance/seller-wallet';
import { requireUser } from '@/server/web/session';
import { PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

export const metadata = { title: 'مستحقاتي من البيع' };

export default async function EarningsPage() {
  const user = await requireUser('/account/earnings');
  const view = await sellerFinancialView(db, user.id);
  return (
    <div className="space-y-5">
      <PageHeader title="مستحقاتي من البيع" description="مكان واحد لمستحقاتك كبائع: من متجرك في السوق ومن الصفقات المحمية، كل واحد لوحده ومعاهم الإجمالي." />
      {!view.marketplace && !view.protectedDeal ? <EmptyState icon={Wallet} title="مفيش مستحقات بيع لحد دلوقتي" description="لما تبيع في السوق أو كبائع في صفقة محمية هتلاقي مستحقاتك هنا." /> : <SellerFinanceSummary view={view} />}
    </div>
  );
}
