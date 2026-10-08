import { Smartphone } from 'lucide-react';
import { removePushDeviceAction, saveNotificationPrefsAction } from '@/app/_actions/notifications';
import { PushOptIn } from '@/app/_components/live/push-optin';
import { formatDate } from '@/lib/format';
import { prefsFor } from '@/server/modules/notifications/message-alerts';
import { listDevices, vapidPublicKey } from '@/server/modules/notifications/push';
import { db } from '@/server/db/client';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert } from '@/ui/feedback';
import { Switch } from '@/ui/form';

/** «رسائل اضمن» notification preferences + browser push devices. Security alerts are separate and mandatory. */
export async function NotificationSettings({ userId, crumbs }: { userId: string; crumbs: { label: string; href?: string }[] }) {
  const [prefs, devices] = await Promise.all([prefsFor(db, userId), listDevices(userId)]);
  return (
    <div className="space-y-5">
      <PageHeader breadcrumbs={<Breadcrumbs items={crumbs} />} title="إعدادات الإشعارات" description="اختار إزاي تعرف إن فيه رسالة جديدة من بائع أو مشتري." className="mb-2" />
      <section className="card space-y-4 p-4" aria-labelledby="msg-prefs">
        <h2 id="msg-prefs" className="font-bold">
          رسائل اضمن
        </h2>
        <ActionForm action={saveNotificationPrefsAction} className="space-y-3" successMessage="تم حفظ إعدادات الإشعارات">
          <input type="hidden" name="_" value="1" />
          <Switch name="messagesInApp" defaultChecked={prefs.messagesInApp} label="إشعارات داخل الموقع (تنبيه منبثق لما توصل رسالة وانت فاتح اضمن)" data-testid="pref-in-app" />
          <Switch name="messagesSound" defaultChecked={prefs.messagesSound} label="الإشعارات الصوتية (نغمة قصيرة مع التنبيه)" data-testid="pref-sound" />
          <Switch name="messagesPush" defaultChecked={prefs.messagesPush} label="إشعارات المتصفح (لما تكون برّه اضمن — على الأجهزة اللي فعّلتها)" data-testid="pref-push" />
          <Switch name="pushPreview" defaultChecked={prefs.pushPreview} label="اعرض جزء من نص الرسالة في إشعار المتصفح (مقفول افتراضيًا للخصوصية)" data-testid="pref-preview" />
          <Switch name="messagesEmail" defaultChecked={prefs.messagesEmail} label="تنبيهات البريد الإلكتروني (لو الرسالة فضلت مش مقروءة — مرة واحدة لكل محادثة كل فترة)" data-testid="pref-email" />
          <SubmitButton>حفظ</SubmitButton>
        </ActionForm>
        <p className="text-xs text-muted">عدّادات الرسائل غير المقروءة بتفضل ظاهرة دايمًا. التنبيهات الأمنية (زي تسجيل الدخول وتغيير بيانات السحب) ليها سياسة منفصلة وبتوصلك في كل الأحوال.</p>
      </section>
      <PushOptIn vapidKey={vapidPublicKey()} />
      <section className="card space-y-3 p-4" aria-labelledby="devices">
        <h2 id="devices" className="font-bold">
          الأجهزة المفعّل عليها إشعارات المتصفح
        </h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">مفيش أجهزة مفعّلة.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="push-devices">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Smartphone className="size-4 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  {d.label || 'جهاز'} <span className="text-xs text-muted">— من {formatDate(d.createdAt)}</span>
                  {d.failureCount > 0 && <span className="ms-2 text-xs text-amber-700">(فيه مشكلة في التوصيل)</span>}
                </span>
                <ActionForm action={removePushDeviceAction} successMessage="تمت الإزالة">
                  <input type="hidden" name="id" value={d.id} />
                  <SubmitButton size="sm" variant="outline">
                    إزالة
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Alert tone="info" title="الإشعار مش إثبات">
        وصول إشعار أو فتحه أو قراءة رسالة مش بيأكد استلام ولا دفع ولا تسليم، ومش بيغيّر أي حاجة في طلبك أو فلوسك. كل ده بيتم من الأزرار الرسمية بس.
      </Alert>
    </div>
  );
}
