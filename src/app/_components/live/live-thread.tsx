'use client';

import { ArrowDown, Loader2, Paperclip, RotateCw, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { sendMessageAction } from '@/app/_actions/messaging';
import { cn } from '@/lib/cn';
import type { MessageDTO, Side } from '@/lib/messaging';
import { EmptyState } from '@/ui/feedback';
import { useLive, type ThreadDelta } from './live-provider';
import { MessageBubble } from './message-bubble';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Merge server messages into the list by id (server copy wins); optimistic ones stay last until confirmed. */
function merge(cur: MessageDTO[], incoming: MessageDTO[], readIds: Set<string>): MessageDTO[] {
  const byId = new Map(cur.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  const all = [...byId.values()].map((m) => (m.mine && readIds.has(m.id) ? { ...m, readByOther: true } : m));
  const confirmed = all.filter((m) => !m.pending);
  const pending = all.filter((m) => m.pending);
  confirmed.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)); // stable: keeps server order on ties
  return [...confirmed, ...pending];
}

/**
 * The open conversation: new messages appear without any reload; draft text, selected files and scroll
 * position are preserved. If the reader scrolled up, new messages are NOT force-scrolled into view — a
 * «رسائل جديدة» button appears instead — and they are only reported as read once actually on screen.
 */
export function LiveThread({
  conversationId,
  surface,
  side,
  partyName,
  initialMessages,
  initialCursor,
  canWrite,
  placeholder,
}: {
  conversationId: string;
  surface: 'account' | 'seller';
  side: Side;
  partyName: Record<Side, string>;
  initialMessages: MessageDTO[];
  initialCursor: string | null;
  canWrite: boolean;
  placeholder: string;
}) {
  const live = useLive();
  const [msgs, setMsgs] = useState<MessageDTO[]>(initialMessages);
  const [newCount, setNewCount] = useState(0);
  const cursor = useRef<string | null>(initialCursor);
  const endRef = useRef<HTMLDivElement>(null);
  const lastMarked = useRef<string | null>(null);
  const msgsRef = useRef(msgs);
  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  const atBottom = useCallback(() => {
    const el = endRef.current;
    if (!el) return true;
    return el.getBoundingClientRect().top < window.innerHeight + 160;
  }, []);
  /**
   * "Pinned" = the reader is following the conversation. Only the reader's own scrolling changes it, so a
   * layout shift (fonts, images loading) never makes us think they scrolled away.
   */
  const pinned = useRef(true);
  const nearBottom = useCallback(() => pinned.current || atBottom(), [atBottom]);
  const toBottom = useCallback((smooth = false) => endRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' }), []);

  /** Report "read up to the newest message on screen" — only for a visible tab scrolled to the end. */
  const markVisibleRead = useCallback(() => {
    if (document.visibilityState !== 'visible' || !nearBottom()) return;
    const newest = [...msgsRef.current].reverse().find((m) => !m.mine && !m.pending);
    if (!newest || newest.id === lastMarked.current) return;
    lastMarked.current = newest.id;
    setNewCount(0);
    void fetch('/api/live/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface, conversationId, upTo: newest.id }),
    })
      .then(async (r) => {
        if (r.ok) {
          const j = (await r.json()) as { unreadMessages?: number };
          if (typeof j.unreadMessages === 'number') live?.setUnreadMessages(j.unreadMessages);
          live?.poke();
        } else lastMarked.current = null;
      })
      .catch(() => {
        lastMarked.current = null;
      });
  }, [conversationId, surface, live, nearBottom]);

  const onDelta = useCallback(
    (d: ThreadDelta) => {
      if (d.cursor) cursor.current = d.cursor;
      const known = new Set(msgsRef.current.map((m) => m.id));
      const arrived = d.messages.filter((m) => !known.has(m.id) && !m.mine);
      const stick = nearBottom();
      setMsgs((cur) => merge(cur, d.messages, new Set(d.readIds)));
      if (arrived.length) {
        // Reading is reported by the effect below once these messages are actually rendered.
        if (stick) requestAnimationFrame(() => toBottom(true));
        else setNewCount((n) => n + arrived.length);
      }
    },
    [nearBottom, toBottom],
  );

  // After every render of new messages: a reader following the conversation has now seen them.
  useEffect(() => {
    if (nearBottom()) markVisibleRead();
  }, [msgs, nearBottom, markVisibleRead]);

  useEffect(() => {
    live?.registerThread({ conversationId, cursor: () => cursor.current, onDelta });
    return () => live?.registerThread(null);
  }, [live, conversationId, onDelta]);

  useEffect(() => {
    toBottom();
    const t = setTimeout(markVisibleRead, 150);
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (atBottom()) pinned.current = true;
      else if (y < lastY) pinned.current = false; // the reader scrolled up
      lastY = y;
      if (nearBottom()) markVisibleRead();
    };
    // Keep a following reader at the newest message while content grows (images, fonts, new bubbles).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (pinned.current && !atBottom()) toBottom();
    }) : null;
    const list = endRef.current?.parentElement;
    if (ro && list) ro.observe(list);
    const onVis = () => markVisibleRead();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [markVisibleRead, atBottom, nearBottom, toBottom]);

  /* ───── composer (idempotent, optimistic, never loses the draft) ───── */
  const formRef = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'sent' | 'error'; text?: string }>({ kind: 'idle' });
  const [fileCount, setFileCount] = useState(0);

  async function submit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const form = formRef.current;
    if (!form || busy) return;
    const fd = new FormData(form);
    const body = String(fd.get('body') ?? '').trim();
    const files = fd.getAll('attachments').filter((f) => typeof f !== 'string' && f.size > 0);
    if (!body && !files.length) {
      setStatus({ kind: 'error', text: 'اكتب رسالتك أو ضيف مرفق' });
      return;
    }
    fd.set('clientKey', key);
    const tmpId = `tmp-${key}`;
    const optimistic: MessageDTO = { id: tmpId, side, mine: true, body, createdAt: new Date().toISOString(), hidden: false, hiddenReason: null, attachments: [], readByOther: false, pending: 'sending' };
    setMsgs((cur) => [...cur.filter((m) => m.id !== tmpId), optimistic]);
    pinned.current = true;
    requestAnimationFrame(() => toBottom(true));
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await sendMessageAction(null, fd);
      if (res.ok) {
        const id = String((res.data as { id?: string } | undefined)?.id ?? '');
        // Keep the bubble (now confirmed) until the live sync brings the authoritative copy (same id).
        setMsgs((cur) => (id && cur.some((m) => m.id === id) ? cur.filter((m) => m.id !== tmpId) : cur.map((m) => (m.id === tmpId ? { ...m, id: id || tmpId, pending: undefined } : m))));
        form.reset();
        setFileCount(0);
        setKey(newKey());
        setStatus({ kind: 'sent', text: 'تم الإرسال' });
        live?.poke();
      } else {
        setMsgs((cur) => cur.map((m) => (m.id === tmpId ? { ...m, pending: 'failed' } : m)));
        setStatus({ kind: 'error', text: res.error ?? 'الرسالة ماتبعتتش' });
      }
    } catch {
      setMsgs((cur) => cur.map((m) => (m.id === tmpId ? { ...m, pending: 'failed' } : m)));
      setStatus({ kind: 'error', text: 'الرسالة ماتبعتتش. اتأكد من الإنترنت وحاول تاني' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section aria-label="الرسائل" className="rounded-2xl bg-white/60 p-2 ring-1 ring-line sm:p-3">
        {msgs.length === 0 ? (
          <EmptyState title="مفيش رسائل لسه" description={side === 'BUYER' ? 'ابدأ التواصل مع البائع' : 'ابدأ التواصل مع المشتري'} className="py-8" />
        ) : (
          <ol className="space-y-3" data-testid="message-list" aria-live="off">
            {msgs.map((m) => (
              <MessageBubble key={m.id} m={m} surface={surface} partyName={partyName} onRetry={m.pending === 'failed' ? () => void submit() : undefined} />
            ))}
          </ol>
        )}
        <div ref={endRef} aria-hidden className="h-px" />
      </section>
      {newCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-44 z-30 flex justify-center lg:bottom-32">
          <button
            type="button"
            onClick={() => {
              pinned.current = true;
              toBottom(true);
              setNewCount(0);
              setTimeout(markVisibleRead, 400);
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-brand-800"
            data-testid="new-messages-pill"
          >
            <ArrowDown className="size-4" aria-hidden /> رسائل جديدة ({newCount})
          </button>
        </div>
      )}
      {canWrite && (
        <div className="sticky bottom-16 z-10 rounded-2xl bg-white p-3 shadow-[var(--shadow-pop)] ring-1 ring-line lg:bottom-2">
          <form ref={formRef} onSubmit={submit} className="space-y-2" data-testid="message-composer" encType="multipart/form-data">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="surface" value={surface} />
            <label htmlFor="message-body" className="sr-only">
              الرسالة
            </label>
            <textarea
              id="message-body"
              name="body"
              rows={2}
              maxLength={2000}
              placeholder={placeholder}
              className="block max-h-40 min-h-[3rem] w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              data-testid="message-input"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:bg-page focus-within:ring-2 focus-within:ring-brand-300">
                <Paperclip className="size-4" aria-hidden />
                <span>{fileCount ? `${fileCount} مرفق` : 'إرفاق صورة أو PDF'}</span>
                <input
                  type="file"
                  name="attachments"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  aria-label="إرفاق صورة أو ملف PDF (حتى 3 ملفات)"
                  onChange={(e) => setFileCount(e.currentTarget.files?.length ?? 0)}
                  data-testid="message-attachments"
                />
              </label>
              <span className="flex-1" />
              {status.kind === 'error' ? (
                <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-60">
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCw className="size-4" aria-hidden />} حاول تاني
                </button>
              ) : (
                <button type="submit" disabled={busy} aria-busy={busy} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60" data-testid="message-send">
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 -scale-x-100" aria-hidden />} {busy ? 'بيتبعت…' : 'إرسال'}
                </button>
              )}
            </div>
            <p role="status" aria-live="polite" className={cn('min-h-4 text-xs', status.kind === 'error' ? 'font-semibold text-red-700' : 'text-emerald-700')} data-testid="message-status">
              {status.kind === 'error' ? `⚠ ${status.text}` : status.kind === 'sent' ? `✓ ${status.text}` : ''}
            </p>
          </form>
        </div>
      )}
    </>
  );
}
