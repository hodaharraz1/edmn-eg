import { Clock, ShieldAlert } from 'lucide-react';
import { LinkButton } from '@/ui/button';
import { Alert } from '@/ui/feedback';
import type { Seller } from '@/server/modules/sellers/service';

/** Shown on Seller Center pages that require an APPROVED seller. */
export function SellerStatusGate({ seller }: { seller: Seller }) {
  if (seller.status === 'DRAFT' || seller.status === 'MORE_INFO_REQUIRED') {
    return (
      <Alert tone="warning" title={seller.status === 'DRAFT' ? 'أكمل طلب الانضمام' : 'مطلوب معلومات إضافية'} action={<LinkButton href="/seller/onboarding" size="sm">متابعة الطلب</LinkButton>}>
        {seller.statusReason ?? 'لن تتمكن من نشر منتجات قبل موافقة فريق اضمن على طلبك.'}
      </Alert>
    );
  }
  if (seller.status === 'PENDING_REVIEW') {
    return (
      <Alert tone="info" title="طلبك قيد المراجعة">
        <span className="inline-flex items-center gap-1"><Clock className="size-4" /> يراجع فريق اضمن بياناتك ووثائقك. سنبلغك فور اتخاذ القرار.</span>
      </Alert>
    );
  }
  if (seller.status === 'SUSPENDED' || seller.status === 'REJECTED' || seller.status === 'RESTRICTED') {
    return (
      <Alert tone="danger" title={seller.status === 'RESTRICTED' ? 'الحساب مقيد' : seller.status === 'SUSPENDED' ? 'الحساب موقوف' : 'تم رفض الطلب'}>
        <span className="inline-flex items-center gap-1"><ShieldAlert className="size-4" /> {seller.statusReason ?? '—'}</span>
      </Alert>
    );
  }
  return null;
}
