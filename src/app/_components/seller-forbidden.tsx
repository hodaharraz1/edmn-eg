import { ShieldX } from 'lucide-react';
import { EmptyState } from '@/ui/feedback';

/** Seller pages re-check the member's store permission server-side (nav hiding is not the control). */
export function SellerForbidden() {
  return <EmptyState icon={ShieldX} title="غير مصرح" description="دورك في المتجر لا يسمح بعرض هذه الصفحة. تواصل مع مالك المتجر." />;
}
