import { ShieldX } from 'lucide-react';
import { hasPermission, type Actor } from '@/server/core/actor';
import type { Permission } from '@/server/rbac/permissions';
import { requireAdmin } from '@/server/web/session';
import { EmptyState } from '@/ui/feedback';

/** Server-side permission gate for admin pages (hiding nav links is never the control). */
export async function adminWith(perm: Permission | Permission[]): Promise<{ actor: Actor; allowed: boolean }> {
  const actor = await requireAdmin();
  const perms = Array.isArray(perm) ? perm : [perm];
  return { actor, allowed: perms.some((p) => hasPermission(actor, p)) };
}

export function Forbidden() {
  return <EmptyState icon={ShieldX} title="غير مصرح" description="ليست لديك صلاحية الوصول لهذه الصفحة. تواصل مع مدير النظام إذا كنت تحتاجها." />;
}
