import { redirect } from 'next/navigation';

/** Legacy invitation URL → the current one (the token is only re-validated there). */
export default async function LegacyDealInvite(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  redirect(`/deal/invite/${encodeURIComponent(token)}`);
}
