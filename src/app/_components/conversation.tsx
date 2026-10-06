import { CheckCheck, Check, FileText, Flag, Info, Lock, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { reportMessageAction } from '@/app/_actions/messaging';
import { AutoRefresh, Composer, ScrollToLatest } from '@/app/_components/conversation-client';
import { formatDate } from '@/lib/format';
import { REPORT_REASON_LABELS, type ConversationContextInfo, type ThreadMessage } from '@/server/modules/messaging/service';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Select, Textarea } from '@/ui/form';
import { cn } from '@/lib/cn';

type Side = 'BUYER' | 'SELLER';

/** Context card: which order/deal this conversation belongs to — always visible above the messages. */
export function ConversationContextCard({ ctx, side, context, href }: { ctx: ConversationContextInfo; side: Side | 'STAFF'; context: 'SELLER_ORDER' | 'DEAL'; href: string }) {
  return (
    <section className="card flex flex-wrap items-start justify-between gap-3 p-4" data-testid="conversation-context">
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-muted">{context === 'DEAL' ? 'صفقة محمية' : 'طلب من السوق'}</p>
        <p className="font-bold" dir="auto">{ctx.ref}</p>
        {ctx.title && <p className="break-words text-sm [overflow-wrap:anywhere]">{ctx.title}</p>}
        <p className="text-xs text-muted">
          {side === 'STAFF' ? (
            <>المشتري: {ctx.buyerName} · البائع: {ctx.sellerName}</>
          ) : side === 'BUYER' ? (
            <>البائع: {ctx.sellerName}</>
          ) : (
            <>المشتري: {ctx.buyerName}</>
          )}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <StatusChip status={ctx.status} />
        <Link href={href} className="text-sm font-semibold text-brand-700 hover:underline">
          {context === 'DEAL' ? 'تفاصيل الصفقة' : 'تفاصيل الطلب'}
        </Link>
      </div>
    </section>
  );
}

/** Small, unobtrusive notices shown in every conversation. */
export function ConversationNotices({ context }: { context: 'SELLER_ORDER' | 'DEAL' }) {
  return (
    <div className="space-y-1.5 rounded-xl bg-page p-3 text-xs text-muted" data-testid="conversation-notices">
      {context === 'DEAL' && (
        <p className="flex items-start gap-1.5" data-testid="deal-terms-notice">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> أي تغيير في السعر أو الشحن أو شروط الصفقة لازم يتأكد من خلال العرض الرسمي.
        </p>
      )}
      <p className="flex items-start gap-1.5">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> خلي تفاصيل الطلب والاتفاق هنا علشان نقدر نرجع لها لو حصلت مشكلة.
      </p>
    </div>
  );
}

export function MessageBubble({ m, viewerSide, surface, partyName, staff }: { m: ThreadMessage; viewerSide: Side | 'STAFF'; surface: 'account' | 'seller' | 'admin'; partyName: Record<Side, string>; staff?: boolean }) {
  const mine = m.mine;
  const who = mine ? 'انت' : partyName[m.side];
  return (
    <li className={cn('flex', staff ? (m.side === 'BUYER' ? 'justify-start' : 'justify-end') : mine ? 'justify-start' : 'justify-end')} data-testid="message" data-side={m.side}>
      <div
        className={cn(
          'max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]',
          mine || (staff && m.side === 'BUYER') ? 'rounded-ss-sm bg-brand-700 text-white' : 'rounded-se-sm bg-white text-ink ring-1 ring-line',
          m.hidden && !staff && 'bg-page text-muted ring-1 ring-line',
        )}
      >
        <p className={cn('text-[11px] font-semibold', mine || (staff && m.side === 'BUYER') ? 'text-white/80' : 'text-muted')}>
          {who}
          {staff && <span className="font-normal"> ({m.side === 'BUYER' ? 'المشتري' : 'البائع'})</span>}
        </p>
        {m.hidden && !staff ? (
          <p className="italic">رسالة اتخفت بواسطة فريق اضمن</p>
        ) : (
          m.body && (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" dir="auto" data-testid="message-body">
              {m.body}
            </p>
          )
        )}
        {staff && m.hidden && (
          <p className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">مخفية عن الطرفين — السبب: {m.hiddenReason}</p>
        )}
        {m.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1" aria-label="المرفقات">
            {m.attachments.map((a) => (
              <li key={a.fileId}>
                {a.mimeType.startsWith('image/') ? (
                  <a href={`/api/files/${a.fileId}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg bg-white ring-1 ring-line">
                    {/* private, authorization-checked file (served by /api/files) */}
                    <img src={`/api/files/${a.fileId}`} alt="صورة مرفقة" loading="lazy" className="h-32 w-auto max-w-[220px] object-contain" />
                  </a>
                ) : (
                  <a href={`/api/files/${a.fileId}?download`} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs underline', mine ? 'bg-white/15' : 'bg-page')}>
                    <FileText className="size-4" aria-hidden /> ملف PDF مرفق
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={cn('flex items-center gap-1 text-[10px]', mine || (staff && m.side === 'BUYER') ? 'text-white/75' : 'text-muted')}>
          <time dateTime={m.createdAt.toISOString()}>{formatDate(m.createdAt, true)}</time>
          {mine &&
            (m.readByOther ? (
              <span className="inline-flex items-center gap-0.5" data-testid="message-read">
                · <CheckCheck className="size-3" aria-hidden /> اتشافت
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5">
                · <Check className="size-3" aria-hidden /> اتبعتت
              </span>
            ))}
          {staff && (m.reportCount ?? 0) > 0 && <span className="rounded bg-red-100 px-1 text-red-800">بلاغات: {m.reportCount}</span>}
        </p>
        {!mine && !staff && !m.hidden && viewerSide !== 'STAFF' && surface !== 'admin' && (
          <details className="text-[11px]">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted hover:text-ink">
              <Flag className="size-3" aria-hidden /> الإبلاغ عن الرسالة
            </summary>
            <ActionForm action={reportMessageAction} className="mt-2 space-y-2 rounded-lg bg-page p-2 text-ink" successMessage="البلاغ وصلنا">
              <input type="hidden" name="messageId" value={m.id} />
              <input type="hidden" name="surface" value={surface} />
              <Select name="reason" required defaultValue="" aria-label="سبب البلاغ" className="h-9 text-xs">
                <option value="" disabled>
                  اختار السبب
                </option>
                {Object.entries(REPORT_REASON_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Textarea name="note" rows={2} maxLength={500} placeholder="تفاصيل (اختياري)" aria-label="تفاصيل البلاغ" className="text-xs" />
              <SubmitButton size="sm" variant="outline">ابعت البلاغ</SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </li>
  );
}

/** Participant conversation view (buyer in the account, store member in the Seller Center, deal seller in the account). */
export function ParticipantConversation({
  conversationId,
  context,
  ctx,
  side,
  surface,
  messages,
  write,
  backHref,
}: {
  conversationId: string;
  context: 'SELLER_ORDER' | 'DEAL';
  ctx: ConversationContextInfo;
  side: Side;
  surface: 'account' | 'seller';
  messages: ThreadMessage[];
  write: { canWrite: boolean; reason: string | null };
  backHref: string;
}) {
  const partyName: Record<Side, string> = { BUYER: ctx.buyerName || 'المشتري', SELLER: ctx.sellerName || 'البائع' };
  const detailsHref = side === 'BUYER' ? ctx.buyerHref : ctx.sellerHref;
  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{side === 'BUYER' ? 'تواصل مع البائع' : 'تواصل مع المشتري'}</h1>
        <Link href={backHref} className="text-sm text-brand-700 hover:underline">
          كل الرسائل
        </Link>
      </div>
      <ConversationContextCard ctx={ctx} side={side} context={context} href={detailsHref} />
      <ConversationNotices context={context} />
      <section aria-label="الرسائل" className="rounded-2xl bg-white/60 p-2 ring-1 ring-line sm:p-3">
        {messages.length === 0 ? (
          <EmptyState title="مفيش رسائل لسه" description={side === 'BUYER' ? 'ابدأ التواصل مع البائع' : 'ابدأ التواصل مع المشتري'} className="py-8" />
        ) : (
          <ol className="space-y-3" data-testid="message-list">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} viewerSide={side} surface={surface} partyName={partyName} />
            ))}
          </ol>
        )}
        <ScrollToLatest count={messages.length} />
      </section>
      {write.canWrite ? (
        <div className="sticky bottom-16 z-10 rounded-2xl bg-white p-3 shadow-[var(--shadow-pop)] ring-1 ring-line lg:bottom-2">
          <Composer conversationId={conversationId} surface={surface} placeholder="اكتب رسالتك..." />
        </div>
      ) : (
        <Alert tone="info" title="المحادثة للقراءة بس">
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3.5" aria-hidden /> {write.reason}
          </span>
        </Alert>
      )}
    </div>
  );
}

/** Conversation list (account / Seller Center). Not a social inbox: every row is an order or a deal. */
export function ConversationList({ items, basePath, emptyText }: { items: import('@/server/modules/messaging/service').ConversationListItem[]; basePath: string; emptyText: string }) {
  if (!items.length) return <EmptyState title="مفيش رسائل لسه" description={emptyText} />;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line" data-testid="conversation-list">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`${basePath}/${c.id}`} className={cn('flex gap-3 p-4 hover:bg-page', c.unread > 0 && 'bg-brand-50/60')}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.ref}</span>
                <span className="text-xs text-muted">{c.context === 'DEAL' ? 'صفقة محمية' : 'طلب'} · {c.side === 'BUYER' ? `البائع: ${c.otherParty}` : `المشتري: ${c.otherParty}`}</span>
              </div>
              {c.title && <p className="truncate text-sm">{c.title}</p>}
              <p className={cn('truncate text-sm', c.unread > 0 ? 'font-semibold text-ink' : 'text-muted')} dir="auto">
                {c.preview || 'مفيش رسائل لسه'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs text-muted">
              {c.lastMessageAt && <time dateTime={c.lastMessageAt.toISOString()}>{formatDate(c.lastMessageAt, true)}</time>}
              {c.unread > 0 && (
                <span className="inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white" data-testid="unread-badge">
                  {c.unread}
                  <span className="sr-only"> رسائل جديدة</span>
                </span>
              )}
              <StatusChip status={c.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
