'use client';

import { Loader2, Paperclip, RotateCw, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { sendMessageAction } from '@/app/_actions/messaging';
import { cn } from '@/lib/cn';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Message composer. A send keeps its idempotency key until it succeeds, so "حاول تاني" after a network
 * failure can never create a duplicate message. Text and selected files are kept on failure.
 */
export function Composer({ conversationId, surface, placeholder }: { conversationId: string; surface: 'account' | 'seller'; placeholder: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState(newKey);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'idle' | 'sent' | 'error'; text?: string }>({ kind: 'idle' });
  const [fileCount, setFileCount] = useState(0);

  function submit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const form = formRef.current;
    if (!form || pending) return;
    const fd = new FormData(form);
    const body = String(fd.get('body') ?? '').trim();
    const hasFiles = fd.getAll('attachments').some((f) => typeof f !== 'string' && f.size > 0);
    if (!body && !hasFiles) {
      setStatus({ kind: 'error', text: 'اكتب رسالتك أو ضيف مرفق' });
      return;
    }
    fd.set('clientKey', key);
    startTransition(async () => {
      try {
        const res = await sendMessageAction(null, fd);
        if (res.ok) {
          form.reset();
          setFileCount(0);
          setKey(newKey());
          setStatus({ kind: 'sent', text: 'تم الإرسال' });
          router.refresh();
        } else {
          setStatus({ kind: 'error', text: res.error ?? 'الرسالة ماتبعتتش' });
        }
      } catch {
        setStatus({ kind: 'error', text: 'الرسالة ماتبعتتش. اتأكد من الإنترنت وحاول تاني' });
      }
    });
  }

  return (
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
            submit();
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
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-60">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCw className="size-4" aria-hidden />} حاول تاني
          </button>
        ) : (
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60" data-testid="message-send">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 -scale-x-100" aria-hidden />} {pending ? 'بيتبعت…' : 'إرسال'}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={cn('min-h-4 text-xs', status.kind === 'error' ? 'font-semibold text-red-700' : 'text-emerald-700')} data-testid="message-status">
        {status.kind === 'error' ? `⚠ ${status.text}` : status.kind === 'sent' ? `✓ ${status.text}` : ''}
      </p>
    </form>
  );
}

/** Re-renders the server view every few seconds while the tab is visible (reliable polling; no extra infra). */
export function AutoRefresh({ intervalMs = 7000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}

/** Keeps the newest message in view on first load and when new messages arrive. */
export function ScrollToLatest({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'end' });
  }, [count]);
  return <div ref={ref} aria-hidden />;
}

/**
 * The layout (nav unread badges) renders in parallel with the page that marks the conversation read,
 * so on first open it can still count it. One refresh right after mount re-renders the layout with
 * the updated read position. Idempotent; no business effect.
 */
export function RefreshAfterRead({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router, conversationId]);
  return null;
}
