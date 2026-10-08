import { ArrowRight, Info, Lock, MessagesSquare, Paperclip, ShieldAlert } from 'lucide-react';
import Link from '@/ui/link';
import { LiveThread } from '@/app/_components/live/live-thread';
import { formatDate, formatRelative } from '@/lib/format';
import type { MessageDTO } from '@/lib/messaging';
import type { ConversationContextInfo, ConversationListItem, ThreadMessage } from '@/server/modules/messaging/service';
import { Breadcrumbs } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
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

/** Server → browser shape of a message (dates as ISO strings). */
export const toDTO = (m: ThreadMessage): MessageDTO => ({ ...m, createdAt: m.createdAt.toISOString() });

/** Participant conversation view (buyer in the account, store member in the Seller Center, deal seller in the account). */
export function ParticipantConversation({
  conversationId,
  context,
  ctx,
  side,
  surface,
  messages,
  cursor,
  write,
  backHref,
}: {
  conversationId: string;
  context: 'SELLER_ORDER' | 'DEAL';
  ctx: ConversationContextInfo;
  side: Side;
  surface: 'account' | 'seller';
  messages: ThreadMessage[];
  cursor: string | null;
  write: { canWrite: boolean; reason: string | null };
  backHref: string;
}) {
  const partyName: Record<Side, string> = { BUYER: ctx.buyerName || 'المشتري', SELLER: ctx.sellerName || 'البائع' };
  const detailsHref = side === 'BUYER' ? ctx.buyerHref : ctx.sellerHref;
  const crumbs =
    surface === 'seller'
      ? [{ label: 'مركز البائع', href: '/seller' }, { label: 'الرسائل', href: '/seller/messages' }, { label: ctx.ref }]
      : context === 'DEAL'
        ? [{ label: 'حسابي', href: '/account' }, { label: 'الصفقات المحمية', href: '/account/deals' }, { label: ctx.ref, href: detailsHref }, { label: 'التواصل' }]
        : [{ label: 'حسابي', href: '/account' }, { label: 'الرسائل', href: '/account/messages' }, { label: ctx.ref }];
  return (
    <div className="space-y-4">
      <div className="hidden sm:block">
        <Breadcrumbs items={crumbs} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Back is a real link (never history manipulation): conversation → inbox. */}
          <Link href={backHref} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-line hover:bg-page" aria-label="رجوع لكل الرسائل" data-testid="conversation-back">
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <h1 className="truncate text-xl font-bold">{side === 'BUYER' ? 'تواصل مع البائع' : 'تواصل مع المشتري'}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={detailsHref} className="font-semibold text-brand-700 hover:underline" data-testid="conversation-context-link">
            {context === 'DEAL' ? 'الرجوع للصفقة' : 'الرجوع للطلب'}
          </Link>
          <Link href={backHref} className="text-brand-700 hover:underline">
            كل الرسائل
          </Link>
        </div>
      </div>
      <ConversationContextCard ctx={ctx} side={side} context={context} href={detailsHref} />
      <ConversationNotices context={context} />
      <LiveThread
        conversationId={conversationId}
        surface={surface}
        side={side}
        partyName={partyName}
        initialMessages={messages.map(toDTO)}
        initialCursor={cursor}
        canWrite={write.canWrite}
        placeholder="اكتب رسالتك..."
      />
      {!write.canWrite && (
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
export function ConversationList({ items, basePath, emptyTitle = 'مفيش رسائل لسه', emptyText }: { items: ConversationListItem[]; basePath: string; emptyTitle?: string; emptyText: string }) {
  if (!items.length) return <EmptyState icon={MessagesSquare} title={emptyTitle} description={emptyText} />;
  const now = new Date();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line" data-testid="conversation-list">
      {items.map((c) => {
        const unread = c.unread > 0;
        return (
          <li key={c.id}>
            <Link
              href={`${basePath}/${c.id}`}
              className={cn('flex gap-3 p-4 hover:bg-page focus-visible:bg-page', unread && 'bg-brand-50/60')}
              data-testid="conversation-row"
              data-unread={unread ? c.unread : 0}
              aria-label={`${c.side === 'BUYER' ? c.otherParty : `المشتري ${c.otherParty}`}، ${c.ref}${unread ? `، ${c.unread === 1 ? 'رسالة جديدة' : `${c.unread} رسائل جديدة`}` : ''}`}
            >
              <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', unread ? 'bg-accent-600' : 'bg-transparent')} aria-hidden />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={cn('truncate', unread ? 'font-bold' : 'font-semibold')} dir="auto">
                    {c.side === 'BUYER' ? c.otherParty : `المشتري: ${c.otherParty}`}
                  </span>
                  <span className="rounded-full bg-page px-2 py-0.5 text-[11px] text-muted">{c.context === 'DEAL' ? 'صفقة محمية' : 'طلب من السوق'}</span>
                </div>
                <p className="text-xs text-muted" dir="auto">
                  {c.ref}
                  {c.title ? ` · ${c.title}` : ''}
                </p>
                <p className={cn('truncate text-sm', unread ? 'font-semibold text-ink' : 'text-muted')} dir="auto">
                  {c.preview === 'مرفق' ? (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="size-3.5" aria-hidden /> مرفق
                    </span>
                  ) : (
                    c.preview || 'مفيش رسائل لسه'
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs text-muted">
                {c.lastMessageAt && (
                  <time dateTime={c.lastMessageAt.toISOString()} title={formatDate(c.lastMessageAt, true)}>
                    {formatRelative(c.lastMessageAt, now)}
                  </time>
                )}
                {unread && (
                  <span className="inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold text-white" data-testid="unread-badge">
                    {c.unread > 99 ? '99+' : c.unread}
                    <span className="sr-only"> {c.unread === 1 ? 'رسالة جديدة' : 'رسائل جديدة'}</span>
                  </span>
                )}
                <StatusChip status={c.status} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Inbox filters + search (plain links/GET form — works without JavaScript). */
export function InboxFilters({ basePath, active, q, withDeals }: { basePath: string; active: string; q: string; withDeals: boolean }) {
  const tabs = [
    { key: 'all', label: 'الكل' },
    { key: 'unread', label: 'غير المقروءة' },
    ...(withDeals
      ? [
          { key: 'orders', label: 'طلبات المتجر' },
          { key: 'deals', label: 'الصفقات المحمية' },
        ]
      : []),
  ];
  const href = (f: string) => `${basePath}?${new URLSearchParams({ ...(f !== 'all' ? { f } : {}), ...(q ? { q } : {}) })}`;
  return (
    <div className="space-y-3">
      <nav aria-label="تصفية المحادثات" className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={t.key === active ? 'page' : undefined}
            className={cn('shrink-0 rounded-full px-3 py-1.5 text-sm ring-1', t.key === active ? 'bg-brand-700 font-semibold text-white ring-brand-700' : 'bg-white text-ink ring-line hover:bg-page')}
            data-testid={`inbox-filter-${t.key}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <form action={basePath} role="search" className="flex gap-2">
        {active !== 'all' && <input type="hidden" name="f" value={active} />}
        <label htmlFor="inbox-q" className="sr-only">
          ابحث برقم الطلب أو الاسم
        </label>
        <input id="inbox-q" name="q" defaultValue={q} maxLength={60} placeholder="ابحث برقم الطلب أو الصفقة أو الاسم" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" data-testid="inbox-search" />
        <button className="h-10 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">بحث</button>
      </form>
    </div>
  );
}
