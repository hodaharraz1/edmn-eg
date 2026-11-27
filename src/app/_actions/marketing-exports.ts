'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { executeMarketingExport, rejectMarketingExport, requestMarketingExport } from '@/server/modules/customers/marketing';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

const PAGE = '/admin/customers/marketing-export';

async function run(fd: FormData, fn: (a: Awaited<ReturnType<typeof requireAdmin>>) => Promise<ActionState | void>) {
  const actor = await requireAdmin();
  const res = await runAction(() => fn(actor));
  revalidatePath(PAGE);
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(PAGE)}`);
  return res;
}

/** Steps 1+2 (requester): the reason AND the explicit confirmation. Nothing is exported yet. */
export async function marketingExportRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const r = await requestMarketingExport(a, { reason: str(fd, 'reason'), confirmed: str(fd, 'confirm') === 'on' });
    return { message: r.created ? 'تم تسجيل طلب التصدير. التنفيذ يحتاج موافقة موظف آخر بنفس الصلاحية — لم يُصدَّر أي بيانات بعد.' : 'عندك طلب تصدير مفتوح بالفعل بانتظار موافقة موظف آخر.' };
  });
}

/** Step 3 (a DIFFERENT staff member): approve + execute. The passphrase is shown ONCE, here, and never stored. */
export async function marketingExportExecuteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    const r = await executeMarketingExport(a, str(fd, 'exportId'));
    if (r.alreadyExecuted) return { message: 'الطلب ده اتنفذ قبل كده.' };
    return { message: `تم تصدير ${r.rowCount} عميل موافق. كلمة فك التشفير (تظهر مرة واحدة فقط — احفظها الآن): ${r.passphrase} — الملف المشفر: ${r.fileName}` };
  });
}

export async function marketingExportRejectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (a) => {
    await rejectMarketingExport(a, str(fd, 'exportId'), str(fd, 'reason'));
    return { message: 'تم رفض طلب التصدير. لم يُصدَّر أي بيانات.' };
  });
}
