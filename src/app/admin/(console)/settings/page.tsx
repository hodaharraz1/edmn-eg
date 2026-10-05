import { settingAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { getAllSettings, SENSITIVE_SETTINGS, SETTINGS_SCHEMA, type SettingKey } from '@/server/modules/settings';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'إعدادات النظام' };

const HINTS: Partial<Record<SettingKey, string>> = {
  'withdrawals.minimumAmount': 'بالقروش (10000 = 100 ج.م)',
  'withdrawals.dualControlThreshold': 'بالقروش — عند/فوق هذا المبلغ يجب أن يختلف منفذ الصرف عن المعتمد',
  'settlement.minimumAmount': 'بالقروش',
  'ledger.adjustmentDualControlThreshold': 'بالقروش',
  'settlement.mode': 'ON_REQUEST | SCHEDULED | HYBRID',
  'settlement.daysOfMonth': 'مصفوفة JSON مثل [1,15]',
  'sellers.businessRequiredDocuments': 'مصفوفة JSON',
  'deals.feeBps': 'نقاط أساس (100 = 1%)',
  'deals.feePayer': 'SELLER | BUYER',
  'returns.statutoryWindowDays': 'حسب قانون حماية المستهلك 181/2018',
};

export default async function Settings() {
  const { allowed } = await adminWith('settings.manage');
  if (!allowed) return <Forbidden />;
  const all = await getAllSettings();
  const keys = Object.keys(SETTINGS_SCHEMA) as SettingKey[];
  return (
    <div className="space-y-4">
      <PageHeader title="إعدادات النظام" description="قيم مُتحقق منها بمخطط صارم. كل تغيير يُسجّل مع القيمة القديمة والجديدة والسبب." />
      <Alert tone="info">الإعدادات المميزة بـ«حساس» تتطلب تحققاً إضافياً حديثاً (2FA).</Alert>
      <div className="space-y-2">
        {keys.map((k) => {
          const v = all[k];
          const shown = Array.isArray(v) ? JSON.stringify(v) : String(v);
          return (
            <ActionForm key={k} action={settingAction} className="card grid items-center gap-2 p-3 md:grid-cols-[2fr_2fr_2fr_auto]">
              <input type="hidden" name="key" value={k} /><input type="hidden" name="back" value="/admin/settings" />
              <div><p className="ltr text-sm font-semibold">{k}</p>{HINTS[k] && <p className="text-xs text-muted">{HINTS[k]}</p>}{SENSITIVE_SETTINGS.includes(k) && <Badge tone="warning">حساس</Badge>}</div>
              <Input name="value" defaultValue={shown} className="ltr" aria-label={k} />
              <Input name="reason" required minLength={3} placeholder="سبب التغيير" aria-label="السبب" />
              <SubmitButton size="sm" variant="outline">حفظ</SubmitButton>
            </ActionForm>
          );
        })}
      </div>
    </div>
  );
}
