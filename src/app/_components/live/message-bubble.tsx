'use client';

import { AlertTriangle, Check, CheckCheck, Clock, FileText, Flag } from 'lucide-react';
import { reportMessageAction } from '@/app/_actions/messaging';
import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/lib/format';
import { REPORT_REASON_LABELS, type MessageDTO, type Side } from '@/lib/messaging';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Select, Textarea } from '@/ui/form';

/**
 * One message. Content is ALWAYS rendered as text (React escapes it): no HTML, no markdown, no auto-links.
 * Attachments are private files served by /api/files (authorization re-checked on every request).
 */
export function MessageBubble({
  m,
  surface,
  partyName,
  staff,
  onRetry,
}: {
  m: MessageDTO;
  surface: 'account' | 'seller' | 'admin';
  partyName: Record<Side, string>;
  staff?: boolean;
  onRetry?: () => void;
}) {
  const mine = m.mine;
  const who = mine ? 'انت' : partyName[m.side];
  const dark = mine || (staff && m.side === 'BUYER');
  return (
    <li className={cn('flex', staff ? (m.side === 'BUYER' ? 'justify-start' : 'justify-end') : mine ? 'justify-start' : 'justify-end')} data-testid="message" data-side={m.side} data-id={m.id} data-pending={m.pending ?? undefined}>
      <div
        className={cn(
          'max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]',
          dark ? 'rounded-ss-sm bg-brand-700 text-white' : 'rounded-se-sm bg-white text-ink ring-1 ring-line',
          m.hidden && !staff && 'bg-page text-muted ring-1 ring-line',
          m.pending === 'failed' && 'ring-2 ring-red-400',
        )}
      >
        <p className={cn('text-[11px] font-semibold', dark ? 'text-white/80' : 'text-muted')}>
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
        {staff && m.hidden && <p className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">مخفية عن الطرفين — السبب: {m.hiddenReason}</p>}
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
        {m.pending && m.attachments.length === 0 && m.body === '' && <p className="text-xs">مرفق…</p>}
        <p className={cn('flex flex-wrap items-center gap-1 text-[10px]', dark ? 'text-white/75' : 'text-muted')}>
          <time dateTime={m.createdAt} title={formatDate(m.createdAt, true)}>
            {formatTime(m.createdAt)}
          </time>
          {mine &&
            (m.pending === 'sending' ? (
              <span className="inline-flex items-center gap-0.5" data-testid="message-sending">
                · <Clock className="size-3" aria-hidden /> بيتبعت…
              </span>
            ) : m.pending === 'failed' ? (
              <span className="inline-flex items-center gap-1 font-semibold text-red-100" data-testid="message-failed">
                · <AlertTriangle className="size-3" aria-hidden /> ماتبعتتش
                {onRetry && (
                  <button type="button" onClick={onRetry} className="rounded bg-white/20 px-1.5 py-0.5 underline" data-testid="message-retry">
                    حاول تاني
                  </button>
                )}
              </span>
            ) : m.readByOther ? (
              <span className="inline-flex items-center gap-0.5" data-testid="message-read">
                · <CheckCheck className="size-3" aria-hidden /> اتشافت
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5" data-testid="message-sent">
                · <Check className="size-3" aria-hidden /> اتبعتت
              </span>
            ))}
          {staff && (m.reportCount ?? 0) > 0 && <span className="rounded bg-red-100 px-1 text-red-800">بلاغات: {m.reportCount}</span>}
        </p>
        {!mine && !staff && !m.hidden && !m.pending && surface !== 'admin' && (
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
              <SubmitButton size="sm" variant="outline">
                ابعت البلاغ
              </SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </li>
  );
}
