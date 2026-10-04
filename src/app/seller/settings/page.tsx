import { and, desc, eq } from 'drizzle-orm';
import { payoutMethodAction, sellerTotpAction, staffAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { sellerMembers, sellerPayoutMethods, users } from '@/server/db/schema';
import { requireSellerActor, currentUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { SELLER_MEMBER_ROLES } from '@/domain/machines';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Field, FormSection, Input, Select } from '@/ui/form';
import { TotpSecret } from './totp-secret';

export const metadata = { title: 'الإعدادات' };

export default async function SellerSettings() {
  const actor = await requireSellerActor('/seller/settings');
  const user = (await currentUser())!;
  const isOwner = actor.sellerPermissions?.has('staff.manage');
  const [methods, members] = await Promise.all([
    db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.sellerId, actor.sellerId!)).orderBy(desc(sellerPayoutMethods.createdAt)),
    db.select({ m: sellerMembers, name: users.fullName, email: users.email }).from(sellerMembers).innerJoin(users, eq(users.id, sellerMembers.userId)).where(and(eq(sellerMembers.sellerId, actor.sellerId!), eq(sellerMembers.isActive, true))),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="الإعدادات" />
      <FormSection title="وسائل استلام الأرباح" description="البيانات الكاملة مشفرة ولا تظهر إلا مقنّعة. أي تغيير يُراجع ويوقف السحب مؤقتاً لحمايتك.">
        <ul className="divide-y divide-line text-sm">
          {methods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{label('payoutType', m.type)} · {m.maskedLabel} {m.isDefault && <Badge tone="brand">الافتراضية</Badge>}</span>
              <span className="flex items-center gap-2 text-xs text-muted">{formatDate(m.createdAt)} <StatusChip status={m.status} /></span>
            </li>
          ))}
        </ul>
        {actor.sellerPermissions?.has('payout.manage') && (
          <ActionForm action={payoutMethodAction} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2" resetOnSuccess>
            <Field label="النوع" htmlFor="payoutType"><Select id="payoutType" name="payoutType"><option value="INSTAPAY">إنستاباي</option><option value="MOBILE_WALLET">محفظة موبايل</option><option value="BANK_ACCOUNT">حساب بنكي</option></Select></Field>
            <Field label="اسم صاحب الحساب" htmlFor="holderName" required><Input id="holderName" name="holderName" required /></Field>
            <Field label="عنوان إنستاباي" htmlFor="instapayAddress"><Input id="instapayAddress" name="instapayAddress" dir="ltr" /></Field>
            <Field label="مزود المحفظة / البنك" htmlFor="walletProvider"><Input id="walletProvider" name="walletProvider" /></Field>
            <Field label="رقم المحفظة" htmlFor="walletNumber"><Input id="walletNumber" name="walletNumber" dir="ltr" /></Field>
            <Field label="اسم البنك" htmlFor="bankName"><Input id="bankName" name="bankName" /></Field>
            <Field label="رقم الحساب" htmlFor="accountNumber"><Input id="accountNumber" name="accountNumber" dir="ltr" /></Field>
            <Field label="IBAN" htmlFor="iban"><Input id="iban" name="iban" dir="ltr" /></Field>
            {user.totpEnabledAt && <Field label="رمز المصادقة الثنائية" htmlFor="totp" required><Input id="totp" name="totp" inputMode="numeric" maxLength={6} required /></Field>}
            <div className="sm:col-span-2"><SubmitButton>إضافة وسيلة</SubmitButton></div>
          </ActionForm>
        )}
      </FormSection>
      <FormSection title="المصادقة الثنائية (2FA)" description="موصى بها لحماية أرباحك. عند التفعيل تُطلب عند تغيير وسائل السحب.">
        {user.totpEnabledAt ? <p className="text-sm text-emerald-700">مفعّلة منذ {formatDate(user.totpEnabledAt)}</p> : <TotpSecret action={sellerTotpAction} />}
      </FormSection>
      {isOwner && (
        <FormSection title="فريق المتجر" description="أضف موظفين بصلاحيات محددة. يجب أن يكون لديهم حساب على اضمن.">
          <ul className="divide-y divide-line text-sm">
            {members.map(({ m, name, email }) => (
              <li key={m.userId} className="flex items-center justify-between py-2">
                <span>{name} <span className="text-xs text-muted ltr">{email}</span> · {label('sellerRole', m.role)}</span>
                <ActionForm action={staffAction}><input type="hidden" name="op" value="remove" /><input type="hidden" name="userId" value={m.userId} /><SubmitButton size="sm" variant="ghost">إزالة</SubmitButton></ActionForm>
              </li>
            ))}
            {members.length === 0 && <li className="py-2 text-muted">لا يوجد موظفون</li>}
          </ul>
          <ActionForm action={staffAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
            <Field label="البريد الإلكتروني" htmlFor="email"><Input id="email" name="email" type="email" dir="ltr" required /></Field>
            <Field label="الدور" htmlFor="role"><Select id="role" name="role">{SELLER_MEMBER_ROLES.filter((r) => r !== 'STORE_OWNER').map((r) => <option key={r} value={r}>{label('sellerRole', r)}</option>)}</Select></Field>
            <SubmitButton>إضافة</SubmitButton>
          </ActionForm>
        </FormSection>
      )}
    </div>
  );
}
