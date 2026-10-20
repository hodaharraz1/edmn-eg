import { and, eq } from 'drizzle-orm';
import { movementCancelAction, movementRejectAction, movementRequestAction } from '@/app/_actions/finance-movements';
import { hasPermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { financialMovementRequests, users, type MovementKind } from '@/server/db/schema';
import { MOVEMENT_LABELS } from '@/server/modules/finance/movements';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Alert } from '@/ui/feedback';
import { Input } from '@/ui/form';

export type OpenMovement = { r: typeof financialMovementRequests.$inferSelect; maker: string } | null;

/** The open (PENDING) Maker request for one movement on one entity, with the Maker's name. */
export async function openMovementFor(kind: MovementKind, entityId: string): Promise<OpenMovement> {
  const [row] = await db
    .select({ r: financialMovementRequests, maker: users.fullName })
    .from(financialMovementRequests)
    .innerJoin(users, eq(users.id, financialMovementRequests.requestedBy))
    .where(and(eq(financialMovementRequests.kind, kind), eq(financialMovementRequests.entityId, entityId), eq(financialMovementRequests.status, 'PENDING')));
  return row ?? null;
}

/** True when `actor` may execute (Checker) the open request: it exists and was made by someone else. */
export const checkerMayExecute = (actor: Actor, open: OpenMovement) => !!open && open.r.requestedBy !== actor.userId;

/**
 * UNIVERSAL MAKER / CHECKER panel. Step 1 (Maker): request the movement for an exact amount — nothing moves.
 * Step 2 (Checker): a DIFFERENT person executes it with the page's own command (rendered by the caller only
 * when `checkerMayExecute`). The Maker can withdraw the request; a Checker can reject it.
 */
export async function MovementPanel({ actor, kind, entityId, amount, back, mode, open, children }: { actor: Actor; kind: MovementKind; entityId: string; amount: number; back: string; mode?: string; open: OpenMovement; children?: React.ReactNode }) {
  const canRequest = hasPermission(actor, 'finance.movement.request');
  const label = MOVEMENT_LABELS[kind];
  if (!open) {
    return (
      <section className="card space-y-3 p-4" data-testid={`movement-maker-${kind}`}>
        <h3 className="font-bold">الخطوة 1 من 2 — طلب الحركة (المنشئ)</h3>
        <p className="text-sm text-muted">{label} بمبلغ <b className="text-ink">{formatEGP(amount)}</b>. كل حركة مالية تحتاج شخصين مختلفين: منشئ يطلب، ومعتمد آخر ينفذ. الطلب وحده لا يحرك أي مبلغ.</p>
        {canRequest ? (
          <ActionForm action={movementRequestAction} className="space-y-2">
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="entityId" value={entityId} /><input type="hidden" name="amount" value={amount} /><input type="hidden" name="back" value={back} />
            {mode && <input type="hidden" name="mode" value={mode} />}
            <Input name="reason" required minLength={10} placeholder="سبب الطلب (10 أحرف على الأقل)" aria-label="سبب طلب الحركة" />
            <SubmitButton variant="outline">طلب {label}</SubmitButton>
          </ActionForm>
        ) : (
          <Alert tone="info">لا تملك صلاحية إنشاء طلب حركة مالية. يطلبها المنفذ المالي أو المراجع المالي.</Alert>
        )}
      </section>
    );
  }
  const mine = open.r.requestedBy === actor.userId;
  return (
    <section className="card space-y-3 p-4" data-testid={`movement-open-${kind}`}>
      <h3 className="font-bold">{mine ? 'طلبك بانتظار معتمد آخر' : 'الخطوة 2 من 2 — اعتماد وتنفيذ (المعتمد)'}</h3>
      <p className="text-sm">
        طلب «{label}» بمبلغ <b>{formatEGP(open.r.amount)}</b> — المنشئ: <b>{open.maker}</b> ({formatDate(open.r.requestedAt, true)}). السبب: {open.r.reason}
      </p>
      {open.r.amount !== amount && <Alert tone="warning">المبلغ الحالي ({formatEGP(amount)}) مختلف عن مبلغ الطلب. التنفيذ سيُرفض — ارفض الطلب واطلب من جديد.</Alert>}
      {mine ? (
        <>
          <Alert tone="info">لا يمكنك تنفيذ حركة أنشأتها بنفسك. يلزم شخص آخر مخوّل.</Alert>
          <ActionForm action={movementCancelAction}>
            <input type="hidden" name="requestId" value={open.r.id} /><input type="hidden" name="back" value={back} />
            <SubmitButton variant="ghost" size="sm">سحب طلبي</SubmitButton>
          </ActionForm>
        </>
      ) : (
        <>
          {children}
          <ActionForm action={movementRejectAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="requestId" value={open.r.id} /><input type="hidden" name="back" value={back} />
            <Input name="reason" required minLength={5} placeholder="سبب رفض الطلب" aria-label="سبب رفض طلب الحركة" className="max-w-sm" />
            <SubmitButton variant="ghost" size="sm">رفض الطلب</SubmitButton>
          </ActionForm>
        </>
      )}
    </section>
  );
}
