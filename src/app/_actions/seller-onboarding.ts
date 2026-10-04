'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addPayoutMethod, saveBusiness, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import type { SellerDocumentKind } from '@/domain/machines';
import { bool, fileOf, int, runAction, str, type ActionState } from '@/server/web/action';
import { requireCustomer } from '@/server/web/session';

export async function startSellerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/sell');
  const res = await runAction(async () => {
    await startApplication(actor, str(fd, 'type') === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL');
  });
  if (res.ok) redirect('/seller/onboarding?step=1');
  return res;
}

export async function onboardingStepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCustomer('/seller/onboarding');
  const step = int(fd, 'step') ?? 1;
  let next = step + 1;
  const res = await runAction(async () => {
    if (step === 1) {
      await saveIdentity(actor, { type: str(fd, 'type') as 'INDIVIDUAL', legalName: str(fd, 'legalName'), nationalId: str(fd, 'nationalId'), mobile: str(fd, 'mobile'), email: str(fd, 'email'), addressLine: str(fd, 'addressLine'), city: str(fd, 'city'), governorateId: int(fd, 'governorateId') ?? 0 });
      if (str(fd, 'type') !== 'BUSINESS') next = 3;
    } else if (step === 2) {
      await saveBusiness(actor, { businessLegalName: str(fd, 'businessLegalName'), commercialRegistrationNo: str(fd, 'commercialRegistrationNo'), taxRegistrationNo: str(fd, 'taxRegistrationNo'), businessAddress: str(fd, 'businessAddress'), authorizedRepresentative: str(fd, 'authorizedRepresentative') });
    } else if (step === 3) {
      await saveStore(actor, { name: str(fd, 'name'), description: str(fd, 'description'), returnAddress: str(fd, 'returnAddress'), returnGovernorateId: int(fd, 'returnGovernorateId') ?? 0, supportPhone: str(fd, 'supportPhone') }, await fileOf(fd, 'logo'));
    } else if (step === 4) {
      for (const kind of ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'COMMERCIAL_REGISTRATION', 'TAX_CARD', 'AUTHORIZATION_LETTER'] as SellerDocumentKind[]) {
        const f = await fileOf(fd, kind);
        if (f) await uploadSellerDocument(actor, kind, f);
      }
    } else if (step === 5) {
      const type = str(fd, 'payoutType');
      await addPayoutMethod(
        actor,
        type === 'BANK_ACCOUNT'
          ? { type: 'BANK_ACCOUNT', holderName: str(fd, 'holderName'), bankName: str(fd, 'bankName'), accountNumber: str(fd, 'accountNumber'), iban: str(fd, 'iban') }
          : type === 'MOBILE_WALLET'
            ? { type: 'MOBILE_WALLET', holderName: str(fd, 'holderName'), walletProvider: str(fd, 'walletProvider'), walletNumber: str(fd, 'walletNumber') }
            : { type: 'INSTAPAY', holderName: str(fd, 'holderName'), instapayAddress: str(fd, 'instapayAddress') },
      );
    } else if (step === 6) {
      await submitApplication(actor, bool(fd, 'acceptAgreement'));
      next = 7;
    }
  });
  revalidatePath('/seller/onboarding');
  if (res.ok) redirect(next === 7 ? '/seller' : `/seller/onboarding?step=${next}`);
  return res;
}
