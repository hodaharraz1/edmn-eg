'use server';

import { revalidatePath } from 'next/cache';
import { savePrefs } from '@/server/modules/notifications/message-alerts';
import { revokeSubscription } from '@/server/modules/notifications/push';
import { markRead } from '@/server/modules/notifications/notify';
import { db } from '@/server/db/client';
import { runAction, str, type ActionState } from '@/server/web/action';
import { requireUser } from '@/server/web/session';

/**
 * Messaging notification preferences of the signed-in user (customer or seller account — same identity).
 * Security/account alerts are not governed here.
 */
export async function saveNotificationPrefsAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const user = await requireUser('/account/notifications/settings');
  const on = (k: string) => fd.get(k) === 'on' || fd.get(k) === 'true';
  return runAction(async () => {
    const prefs = await savePrefs(user.id, {
      messagesInApp: on('messagesInApp'),
      messagesSound: on('messagesSound'),
      messagesPush: on('messagesPush'),
      messagesEmail: on('messagesEmail'),
      pushPreview: on('pushPreview'),
    });
    revalidatePath('/account/notifications/settings');
    revalidatePath('/seller/notifications/settings');
    return { message: 'تم حفظ إعدادات الإشعارات', data: { ...prefs } };
  });
}

/** Toggle one preference instantly (e.g. the sound switch inside a toast area). */
export async function setSoundPrefAction(enabled: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser('/account');
  await savePrefs(user.id, { messagesSound: !!enabled });
  return { ok: true };
}

export async function removePushDeviceAction(_p: ActionState | null, fd: FormData): Promise<ActionState> {
  const user = await requireUser('/account/notifications/settings');
  return runAction(async () => {
    await revokeSubscription(user.id, { id: str(fd, 'id') });
    revalidatePath('/account/notifications/settings');
    revalidatePath('/seller/notifications/settings');
    return { message: 'تمت إزالة الجهاز' };
  });
}

/** Mark one notification (or all) read for the current user. */
export async function markNotificationReadAction(fd: FormData): Promise<void> {
  const user = await requireUser('/account/notifications');
  const id = str(fd, 'id');
  await markRead(db, user.id, id ? [id] : undefined);
  revalidatePath('/account/notifications');
  revalidatePath('/seller/notifications');
}
