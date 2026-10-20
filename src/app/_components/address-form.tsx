import { saveAddressAction } from '@/app/_actions/checkout';
import { allGovernorates } from '@/server/web/context';
import { ActionForm, FieldError, SubmitButton } from '@/ui/action-form';
import { Checkbox, Field, Input, Select } from '@/ui/form';
import type { addresses } from '@/server/db/schema';

export async function AddressForm({ back, address, defaultName, defaultPhone }: { back?: string; address?: typeof addresses.$inferSelect; defaultName?: string; defaultPhone?: string }) {
  const govs = await allGovernorates();
  return (
    <ActionForm action={saveAddressAction} className="grid gap-3 sm:grid-cols-2" successMessage="العنوان اتحفظ">
      {back && <input type="hidden" name="back" value={back} />}
      {address && <input type="hidden" name="id" value={address.id} />}
      <Field label="اسم المستلم" htmlFor="recipientName" required>
        <Input id="recipientName" name="recipientName" defaultValue={address?.recipientName ?? defaultName} required />
        <FieldError name="recipientName" />
      </Field>
      <Field label="رقم الموبايل" htmlFor="phone" required>
        <Input id="phone" name="phone" type="tel" dir="ltr" className="text-start" defaultValue={address?.phone ?? defaultPhone?.replace('+20', '0')} required />
        <FieldError name="phone" />
      </Field>
      <Field label="المحافظة" htmlFor="governorateId" required>
        <Select id="governorateId" name="governorateId" defaultValue={address?.governorateId ?? ''} required>
          <option value="" disabled>اختار المحافظة</option>
          {govs.map((g) => (
            <option key={g.id} value={g.id}>{g.nameAr}</option>
          ))}
        </Select>
        <FieldError name="governorateId" />
      </Field>
      <Field label="المدينة / المنطقة" htmlFor="city" required>
        <Input id="city" name="city" defaultValue={address?.city} required />
      </Field>
      <Field label="الحي" htmlFor="district">
        <Input id="district" name="district" defaultValue={address?.district ?? ''} />
      </Field>
      <Field label="الشارع" htmlFor="street" required>
        <Input id="street" name="street" defaultValue={address?.street} required />
      </Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label="رقم العقار" htmlFor="building"><Input id="building" name="building" defaultValue={address?.building ?? ''} /></Field>
        <Field label="الدور" htmlFor="floor"><Input id="floor" name="floor" defaultValue={address?.floor ?? ''} /></Field>
        <Field label="الشقة" htmlFor="apartment"><Input id="apartment" name="apartment" defaultValue={address?.apartment ?? ''} /></Field>
      </div>
      <Field label="علامة مميزة" htmlFor="landmark" className="sm:col-span-2"><Input id="landmark" name="landmark" defaultValue={address?.landmark ?? ''} /></Field>
      <Field label="اسم العنوان (اختياري)" htmlFor="label"><Input id="label" name="label" placeholder="البيت / الشغل" defaultValue={address?.label ?? ''} /></Field>
      <div className="flex items-end"><Checkbox name="isDefault" defaultChecked={address?.isDefault} label="خليه العنوان الافتراضي" /></div>
      <div className="sm:col-span-2"><SubmitButton>حفظ العنوان</SubmitButton></div>
    </ActionForm>
  );
}
