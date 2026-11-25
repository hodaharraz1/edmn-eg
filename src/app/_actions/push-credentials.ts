'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveDevicePushCredentials } from '@/server/modules/notifications/device-push';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireAdmin } from '@/server/web/session';

const PAGE = '/admin/notifications';

/**
 * Live push-provider credentials (PKG-PUSH-02). The values are written to the ENCRYPTED server-side store and are
 * never shown again — the screen afterwards shows non-secret metadata only. settings.manage + step-up (enforced
 * inside saveDevicePushCredentials).
 */
export async function pushCredentialsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  const res = await runAction(async () => {
    const provider = str(fd, 'provider');
    if (provider === 'FCM') {
      let json: unknown;
      try {
        json = JSON.parse(str(fd, 'serviceAccountJson'));
      } catch {
        return { error: 'ملف JSON غير صالح — الصق ملف حساب الخدمة كما نزّلته من Firebase' };
      }
      await saveDevicePushCredentials(actor, 'FCM', json);
      return { message: 'اتحفظت بيانات Firebase مشفّرة. الإرسال الفعلي يفضل مقفول حتى تشغيل notifications.devicePushDriver = live و notifications.devicePushEnabled.' };
    }
    if (provider === 'APNS') {
      await saveDevicePushCredentials(actor, 'APNS', {
        teamId: str(fd, 'teamId'),
        keyId: str(fd, 'keyId'),
        bundleId: str(fd, 'bundleId'),
        privateKeyP8: str(fd, 'privateKeyP8'),
        sandbox: str(fd, 'sandbox') === 'on',
      });
      return { message: 'اتحفظت بيانات Apple مشفّرة. الإرسال الفعلي يفضل مقفول حتى تشغيل notifications.devicePushDriver = live و notifications.devicePushEnabled.' };
    }
    return { error: 'مزوّد غير معروف' };
  });
  revalidatePath(PAGE);
  if (res.code === 'STEP_UP_REQUIRED') redirect(`/admin/step-up?next=${encodeURIComponent(PAGE)}`);
  return res;
}
