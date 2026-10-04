import { createProductAction } from '@/app/_actions/seller';
import { SellerStatusGate } from '@/app/_components/seller-gate';
import { db } from '@/server/db/client';
import { categoryTree } from '@/server/modules/catalog/taxonomy';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { currentUser } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Stepper } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { PRODUCT_STEPS } from '@/app/_components/product-steps';
import { Field, Input, Radio, Select } from '@/ui/form';

export const metadata = { title: 'إضافة منتج' };


export default async function NewProductPage() {
  const user = (await currentUser())!;
  const ctx = (await sellerContextForUser(user.id))!;
  const tree = await categoryTree(db, { activeOnly: true });
  type N = (typeof tree)[number];
  const flat: { id: string; label: string; restricted: boolean }[] = [];
  const walk = (nodes: N[], prefix: string) => {
    for (const n of nodes) {
      if (n.isProhibited) continue;
      flat.push({ id: n.id, label: prefix + n.nameAr, restricted: n.isRestricted });
      walk(n.children as N[], `${prefix}${n.nameAr} › `);
    }
  };
  walk(tree, '');
  if (ctx.seller.status !== 'APPROVED') {
    return (
      <div className="space-y-4">
        <PageHeader title="إضافة منتج" />
        <SellerStatusGate seller={ctx.seller} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="إضافة منتج جديد" description="لن يظهر المنتج للعملاء قبل مراجعته والموافقة عليه من فريق اضمن." />
      <Stepper steps={PRODUCT_STEPS} current={1} />
      <ActionForm action={createProductAction} className="card space-y-4 p-5">
        <Field label="التصنيف" htmlFor="categoryId" required hint="اختر أدق تصنيف مناسب — يحدد المواصفات المطلوبة والعمولة">
          <Select id="categoryId" name="categoryId" required defaultValue="">
            <option value="" disabled>اختر التصنيف</option>
            {flat.map((c) => <option key={c.id} value={c.id}>{c.label}{c.restricted ? ' (مراجعة خاصة)' : ''}</option>)}
          </Select>
        </Field>
        <Field label="اسم المنتج" htmlFor="titleAr" required hint="مثال: سامسونج جالاكسي A55 5G - 128 جيجا"><Input id="titleAr" name="titleAr" required minLength={5} maxLength={200} /></Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">حالة المنتج</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Radio name="condition" value="NEW" defaultChecked label="جديد" description="منتج جديد لم يُستخدم" />
            <Radio name="condition" value="USED" label="مستعمل" description="يتطلب صوراً حقيقية للقطعة وإفصاحاً عن العيوب" />
          </div>
        </fieldset>
        <SubmitButton>متابعة</SubmitButton>
      </ActionForm>
    </div>
  );
}
