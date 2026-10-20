import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db } from '@/server/db/client';
import { addresses } from '@/server/db/schema';
import { parse } from '../_shared';

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional().default(''),
  recipientName: z.string().trim().min(3, 'اسم المستلم مطلوب').max(120),
  phone: z.string().trim().min(8, 'رقم الموبايل مطلوب'),
  governorateId: z.coerce.number().int().positive('اختر المحافظة'),
  city: z.string().trim().min(2, 'المدينة / المنطقة مطلوبة').max(100),
  district: z.string().trim().max(100).optional().default(''),
  street: z.string().trim().min(3, 'الشارع مطلوب').max(200),
  building: z.string().trim().max(40).optional().default(''),
  floor: z.string().trim().max(20).optional().default(''),
  apartment: z.string().trim().max(20).optional().default(''),
  landmark: z.string().trim().max(200).optional().default(''),
  isDefault: z.boolean().default(false),
});

export async function saveAddress(actor: Actor, id: string | null, input: z.input<typeof addressSchema>) {
  const userId = requireUser(actor);
  const d = parse(addressSchema, input);
  const phone = normalizeEgyptMobile(d.phone);
  if (!phone) throw validation('رقم الموبايل غير صحيح', { phone: ['رقم الموبايل غير صحيح'] });
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.archivedAt)));
    if (!id && existing.length >= 20) throw validation('تقدر تحفظ 20 عنوان بالكتير');
    const makeDefault = d.isDefault || existing.length === 0;
    if (makeDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    const values = { ...d, phone, label: d.label || null, district: d.district || null, building: d.building || null, floor: d.floor || null, apartment: d.apartment || null, landmark: d.landmark || null, isDefault: makeDefault };
    if (id) {
      const [a] = await tx.select().from(addresses).where(eq(addresses.id, id));
      if (!a) throw notFound('العنوان');
      if (a.userId !== userId) throw forbidden();
      // Orders keep their own snapshot, so editing an address never changes past orders.
      await tx.update(addresses).set(values).where(eq(addresses.id, id));
      return id;
    }
    const [row] = await tx.insert(addresses).values({ ...values, userId }).returning({ id: addresses.id });
    return row.id;
  });
}

export async function archiveAddress(actor: Actor, id: string) {
  const userId = requireUser(actor);
  const [a] = await db.select().from(addresses).where(eq(addresses.id, id));
  if (!a || a.userId !== userId) throw forbidden();
  await db.update(addresses).set({ archivedAt: new Date(), isDefault: false }).where(eq(addresses.id, id));
}

export async function myAddresses(userId: string) {
  return db.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.archivedAt))).orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}
