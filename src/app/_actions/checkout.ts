'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { placeOrder } from '@/server/modules/commerce/orders';
import { saveAddress } from '@/server/modules/customers/addresses';
import { submitProof } from '@/server/modules/payments/service';
import { cancelUnpaidOrder } from '@/server/modules/commerce/orders';
import { bool, fileOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requireCustomer } from '@/server/web/session';

function addressInput(fd: FormData) {
  return {
    label: str(fd, 'label'),
    recipientName: str(fd, 'recipientName'),
    phone: str(fd, 'phone'),
    governorateId: int(fd, 'governorateId') ?? 0,
    city: str(fd, 'city'),
    district: str(fd, 'district'),
    street: str(fd, 'street'),
    building: str(fd, 'building'),
    floor: str(fd, 'floor'),
    apartment: str(fd, 'apartment'),
    landmark: str(fd, 'landmark'),
    isDefault: bool(fd, 'isDefault'),
  };
}

export async function saveAddressAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/addresses');
  let id = '';
  const res = await runAction(async () => {
    id = await saveAddress(actor, str(fd, 'id') || null, addressInput(fd));
    return { message: 'تم حفظ العنوان' };
  });
  const back = str(fd, 'back');
  if (res.ok && back === 'checkout') redirect(`/checkout?address=${id}`);
  revalidatePath('/account/addresses');
  return res;
}

export async function placeOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/checkout');
  let orderId = '';
  const res = await runAction(async () => {
    const { order } = await placeOrder(actor, {
      addressId: str(fd, 'addressId'),
      paymentMethod: str(fd, 'paymentMethod') as 'INSTAPAY',
      checkoutKey: str(fd, 'checkoutKey'),
      expectedTotal: int(fd, 'expectedTotal') ?? -1,
      note: str(fd, 'note'),
    });
    orderId = order.id;
  });
  if (res.ok) redirect(`/account/orders/${orderId}/pay`);
  revalidatePath('/checkout');
  return res;
}

export async function submitProofAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/account/orders');
  const back = str(fd, 'back');
  const res = await runAction(async () => {
    await submitProof(
      actor,
      str(fd, 'paymentId'),
      { claimedAmount: str(fd, 'claimedAmount'), reference: str(fd, 'reference'), payerName: str(fd, 'payerName'), notes: str(fd, 'notes'), clientKey: str(fd, 'clientKey') },
      await fileOf(fd, 'proof'),
    );
    return { message: 'تم استلام إثبات الدفع. سيقوم فريق اضمن بالتحقق منه ونبلغك فور التأكيد.' };
  });
  if (res.ok && back) redirect(back);
  return res;
}

export async function cancelUnpaidOrderAction(fd: FormData) {
  const actor = await requireCustomer('/account/orders');
  await runAction(async () => cancelUnpaidOrder(actor, str(fd, 'orderId')));
  revalidatePath(`/account/orders/${str(fd, 'orderId')}`);
}
