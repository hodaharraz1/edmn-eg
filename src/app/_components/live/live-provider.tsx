'use client';

import { Bell, MessageSquareText, Paperclip, X } from 'lucide-react';
import Link from '@/ui/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IncomingAlert, MessageDTO } from '@/lib/messaging';
import { playChime, unlockAudio } from './sound';

/**
 * Live layer of the web app: global unread badges, incoming-message toasts (+ optional chime), and updates
 * for the conversation on screen — without page reloads.
 *
 * Transport: one cursor-based poll of /api/live — ≈6 s while the tab is visible, 30 s in the background,
 * immediately on focus / reconnect / after an action — with exponential back-off on errors. Every tab is
 * independent and the server stays authoritative; tabs only coordinate to avoid duplicate toasts.
 */

export type Surface = 'account' | 'seller';

export interface ThreadDelta {
  conversationId: string;
  messages: MessageDTO[];
  cursor: string | null;
  readIds: string[];
}

interface ThreadReg {
  conversationId: string;
  cursor: () => string | null;
  onDelta: (d: ThreadDelta) => void;
}

/**
 * Three contexts so that an update only re-renders what depends on it: stable functions (never change),
 * unread counts (change only when a count changes) and the inbox version (inbox pages only). This also keeps
 * React from re-rendering server-streamed content that is still hydrating.
 */
interface LiveApi {
  surface: Surface;
  poke: () => void;
  registerThread: (reg: ThreadReg | null) => void;
  setUnreadMessages: (n: number) => void;
}
interface LiveCounts {
  unreadMessages: number;
  unreadNotifications: number;
}

const ApiCtx = createContext<LiveApi | null>(null);
const CountsCtx = createContext<LiveCounts | null>(null);
const InboxCtx = createContext<string | null>(null);
export const useLive = () => useContext(ApiCtx);

const VISIBLE_MS = 6_000;
/** first sync shortly after mount (lets streamed server content finish hydrating first) */
const FIRST_MS = 1_200;
const HIDDEN_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_TOASTS = 3;
/** A full snapshot at least this often even when the change token says nothing changed (safety net). */
const FULL_EVERY_MS = 5 * 60_000;
const TOAST_MS = 9_000;

interface Snapshot {
  userKey: string;
  token?: string;
  unreadMessages: number;
  unreadNotifications: number;
  cursor: string;
  incoming: IncomingAlert[];
  seen: string[];
  inboxVersion: string;
  thread: ThreadDelta | null;
}

interface Toast extends IncomingAlert {
  key: string;
}

/** Cross-tab de-duplication of toasts (best effort; the server state never depends on it). */
function claimToast(id: string): boolean {
  try {
    const k = `edmn:toast:${id}`;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, String(Date.now()));
    // light cleanup
    if (Math.random() < 0.05) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('edmn:toast:') && Date.now() - Number(localStorage.getItem(key)) > 86_400_000) localStorage.removeItem(key);
      }
    }
    return true;
  } catch {
    return true;
  }
}

export function LiveProvider({
  surface,
  initialUnreadMessages,
  initialUnreadNotifications,
  inApp,
  sound,
  pushKey,
  userKey,
  children,
}: {
  surface: Surface;
  /** opaque per-user key (server-derived): scopes the cross-tab channel and the leader lock to ONE account */
  userKey: string;
  initialUnreadMessages: number;
  initialUnreadNotifications: number;
  inApp: boolean;
  sound: boolean;
  pushKey: string | null;
  children: ReactNode;
}) {
  const [unreadMessages, setUnreadMessages] = useState(initialUnreadMessages);
  const [unreadNotifications, setUnreadNotifications] = useState(initialUnreadNotifications);
  const [inboxVersion, setInboxVersion] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announce, setAnnounce] = useState('');
  const pathname = usePathname();

  const cursor = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const thread = useRef<ThreadReg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const failures = useRef(0);
  const stopped = useRef(false);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const bc = useRef<BroadcastChannel | null>(null);
  const pollRef = useRef<() => Promise<void>>(async () => undefined);
  /** Only the leader tab polls; followers receive its snapshots. Without Web Locks every tab leads (fallback). */
  const leader = useRef(false);
  const coordinated = useRef(false);
  const token = useRef<string | null>(null);
  const lastFull = useRef(0);
  const forceFull = useRef(true);
  const applyRef = useRef<(snap: Snapshot, visible: boolean) => void>(() => undefined);

  const schedule = useCallback((ms?: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (stopped.current) return;
    // Followers rely on the leader, except while showing an open conversation (kept live by its own cheap token check).
    if (coordinated.current && !leader.current && !thread.current) {
      if (ms !== undefined && ms <= 300) bc.current?.postMessage({ type: 'poke' }); // ask the leader instead
      return;
    }
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const base = visible ? VISIBLE_MS : HIDDEN_MS;
    const delay = ms ?? (failures.current ? Math.min(MAX_BACKOFF_MS, base * 2 ** failures.current) : base);
    timer.current = setTimeout(() => void pollRef.current(), delay);
  }, []);

  /** Apply a snapshot (own poll or the leader's broadcast): counts, inbox, open thread, toasts in a visible tab. */
  const apply = useCallback(
    (snap: Snapshot, visible: boolean) => {
      setUnreadMessages(snap.unreadMessages);
      setUnreadNotifications(snap.unreadNotifications);
      setInboxVersion(snap.inboxVersion);
      for (const id of snap.seen) seen.current.add(id);
      const fresh = snap.incoming.filter((m) => !seen.current.has(m.id));
      for (const m of fresh) seen.current.add(m.id);
      if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-250));
      cursor.current = snap.cursor;
      if (snap.thread && thread.current?.conversationId === snap.thread.conversationId) thread.current.onDelta(snap.thread);

      // Toasts only in a visible tab, never for the conversation already on screen, once across tabs.
      if (fresh.length && visible && inApp) {
        const show = fresh.filter((m) => m.conversationId !== thread.current?.conversationId && !pathRef.current.endsWith(`/messages/${m.conversationId}`) && claimToast(m.id));
        // One toast per conversation per batch (a burst of messages is one alert).
        const byConv = new Map<string, IncomingAlert & { count: number }>();
        for (const m of show) {
          const prev = byConv.get(m.conversationId);
          byConv.set(m.conversationId, { ...m, count: (prev?.count ?? 0) + 1 });
        }
        const list = [...byConv.values()];
        if (list.length) {
          setToasts((t) => [...list.map((m) => ({ ...m, key: `${m.id}` })), ...t].slice(0, MAX_TOASTS));
          setAnnounce(list.length === 1 ? `رسالة جديدة من ${list[0].from} بخصوص ${list[0].ref}` : `${list.length} رسائل جديدة`);
          if (sound) playChime();
        }
      }
    },
    [inApp, sound],
  );
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  const poll = useCallback(async () => {
    if (stopped.current) return;
    if (coordinated.current && !leader.current && !thread.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    const visible = document.visibilityState === 'visible';
    const params = new URLSearchParams({ surface, visible: visible ? '1' : '0' });
    if (cursor.current) params.set('since', cursor.current);
    const reg = thread.current;
    if (reg) {
      params.set('conv', reg.conversationId);
      const c = reg.cursor();
      if (c) params.set('after', c);
    }
    // Cheap check: send the last change token unless a full refresh is due (focus, reconnect, takeover, 5 min).
    const full = forceFull.current || Date.now() - lastFull.current > FULL_EVERY_MS;
    if (token.current && !full) params.set('v', token.current);
    try {
      const res = await fetch(`/api/live?${params}`, { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (res.status === 401) {
        stopped.current = true; // signed out: stop quietly, and stop the other tabs too
        bc.current?.postMessage({ type: 'stop' });
        return;
      }
      if (res.status === 204) {
        failures.current = 0; // nothing changed since our token
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const snap = (await res.json()) as Snapshot;
      if (snap.userKey !== userKey) {
        // The browser session now belongs to another account: never show or relay its data here.
        stopped.current = true;
        bc.current?.postMessage({ type: 'stop' });
        return;
      }
      failures.current = 0;
      forceFull.current = false;
      lastFull.current = Date.now();
      token.current = snap.token ?? null; // our own token (it includes our open conversation, if any)
      apply(snap, visible);
      if (leader.current || !coordinated.current) bc.current?.postMessage({ type: 'snap', snap });
    } catch {
      failures.current = Math.min(failures.current + 1, 6);
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        schedule(50);
      } else schedule();
    }
  }, [surface, userKey, apply, schedule]);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const poke = useCallback(() => {
    failures.current = 0;
    schedule(0);
    bc.current?.postMessage({ type: 'poke' });
  }, [schedule]);

  useEffect(() => {
    stopped.current = false;
    const name = `edmn-live:${surface}:${userKey}`;
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    let release: (() => void) | null = null;
    let disposed = false;

    try {
      bc.current = new BroadcastChannel(name);
      bc.current.onmessage = (e: MessageEvent<{ type: string; snap?: Snapshot }>) => {
        const msg = e.data;
        if (msg?.type === 'poke' && leader.current) schedule(300); // a follower read/sent something: reconcile now
        if (msg?.type === 'snap' && msg.snap && !leader.current && msg.snap.userKey === userKey) applyRef.current(msg.snap, document.visibilityState === 'visible');
        if (msg?.type === 'stop') stopped.current = true;
      };
    } catch {
      bc.current = null;
    }

    const becomeLeader = () => {
      leader.current = true;
      forceFull.current = true; // takeover: resync everything after our own cursor
      failures.current = 0;
      schedule(0);
    };
    /** Queue for (or, when visible, take over) the per-account leader lock; the browser frees it if a tab closes or crashes. */
    const acquire = (steal: boolean) => {
      if (!locks || disposed) return;
      void locks
        .request(name, steal ? { steal: true } : {}, () => {
          becomeLeader();
          return new Promise<void>((r) => {
            release = r;
          });
        })
        .catch(() => {
          // Our lock was taken over by a visible tab: follow, and queue again for the next takeover.
          leader.current = false;
          release = null;
          if (!disposed) acquire(false);
        });
    };

    if (locks && bc.current) {
      coordinated.current = true;
      // A visible tab leads (so an active user keeps ~6 s latency); hidden tabs queue up as stand-ins.
      if (document.visibilityState === 'visible') setTimeout(() => acquire(true), FIRST_MS);
      else acquire(false);
    } else {
      coordinated.current = false; // no Web Locks / BroadcastChannel: every tab polls on its own (safe fallback)
      schedule(FIRST_MS);
    }

    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      forceFull.current = true;
      if (coordinated.current && !leader.current) acquire(true);
      else schedule(0);
    };
    const onNow = () => {
      failures.current = 0;
      forceFull.current = true;
      if (coordinated.current && !leader.current) bc.current?.postMessage({ type: 'poke' });
      else schedule(0);
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onNow);
    window.addEventListener('online', onNow);
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      disposed = true;
      stopped.current = true;
      leader.current = false;
      if (timer.current) clearTimeout(timer.current);
      (release as (() => void) | null)?.();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onNow);
      window.removeEventListener('online', onNow);
      bc.current?.close();
    };
  }, [schedule, surface, userKey]);

  // Keep an existing push subscription fresh (never prompts; opt-in happens only on an explicit click).
  useEffect(() => {
    if (!pushKey) return;
    void refreshPushSubscription();
  }, [pushKey]);

  const registerThread = useCallback(
    (reg: ThreadReg | null) => {
      thread.current = reg;
      if (reg) {
        forceFull.current = true;
        schedule(0);
      }
    },
    [schedule],
  );

  const api = useMemo<LiveApi>(() => ({ surface, poke, registerThread, setUnreadMessages }), [surface, poke, registerThread]);
  const counts = useMemo<LiveCounts>(() => ({ unreadMessages, unreadNotifications }), [unreadMessages, unreadNotifications]);

  const dismiss = (key: string) => setToasts((t) => t.filter((x) => x.key !== key));

  return (
    <ApiCtx.Provider value={api}>
      <CountsCtx.Provider value={counts}>
        <InboxCtx.Provider value={inboxVersion}>{children}</InboxCtx.Provider>
      </CountsCtx.Provider>
      <p className="sr-only" role="status" aria-live="polite" data-testid="live-announcer">
        {announce}
      </p>
      <div className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:end-4 sm:top-4 sm:w-96" aria-label="التنبيهات" role="region">
        {toasts.map((t) => (
          <ToastCard key={t.key} t={t} surface={surface} onClose={() => dismiss(t.key)} />
        ))}
      </div>
    </ApiCtx.Provider>
  );
}

function ToastCard({ t, surface, onClose }: { t: Toast & { count?: number }; surface: Surface; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover) return;
    const id = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(id);
  }, [hover, onClose]);
  const count = (t as { count?: number }).count ?? 1;
  return (
    <div
      className="pointer-events-auto rounded-2xl bg-white p-3 shadow-[var(--shadow-pop)] ring-1 ring-line"
      data-testid="message-toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700" aria-hidden>
          <MessageSquareText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" dir="auto">
            {surface === 'seller' || t.from === 'المشتري' ? 'رسالة جديدة من المشتري' : `رسالة جديدة من ${t.from}`}
            {count > 1 && <span className="ms-1 text-xs font-semibold text-accent-700">({count})</span>}
          </p>
          <p className="text-xs text-muted" dir="auto">
            بخصوص {t.ref}
          </p>
          {(t.preview || t.attachment) && (
            <p className="mt-1 line-clamp-1 text-sm text-ink" dir="auto">
              {t.attachment && !t.preview ? (
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="size-3.5" aria-hidden /> مرفق
                </span>
              ) : (
                t.preview
              )}
            </p>
          )}
          <Link href={t.href} onClick={onClose} className="mt-2 inline-flex h-9 items-center rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white hover:bg-brand-800" data-testid="toast-open">
            عرض الرسالة
          </Link>
        </div>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-page" aria-label="إغلاق التنبيه">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

async function refreshPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
    const last = Number(localStorage.getItem('edmn:push:refreshed') ?? 0);
    if (Date.now() - last < 12 * 3600_000) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    localStorage.setItem('edmn:push:refreshed', String(Date.now()));
  } catch {
    /* best effort */
  }
}

/* ───────── Badges (read the live counts; fall back to the server-rendered value) ───────── */

export function messagesLabel(n: number) {
  if (n <= 0) return 'الرسائل';
  if (n === 1) return 'الرسائل، رسالة واحدة غير مقروءة';
  if (n === 2) return 'الرسائل، رسالتان غير مقروءتين';
  return `الرسائل، ${n} ${n <= 10 ? 'رسائل غير مقروءة' : 'رسالة غير مقروءة'}`;
}
export function notificationsLabel(n: number) {
  if (n <= 0) return 'الإشعارات';
  if (n === 1) return 'الإشعارات، إشعار واحد غير مقروء';
  if (n === 2) return 'الإشعارات، إشعاران غير مقروءين';
  return `الإشعارات، ${n} ${n <= 10 ? 'إشعارات غير مقروءة' : 'إشعار غير مقروء'}`;
}

export function useCount(kind: 'messages' | 'notifications', fallback = 0) {
  const counts = useContext(CountsCtx);
  if (!counts) return fallback;
  return kind === 'messages' ? counts.unreadMessages : counts.unreadNotifications;
}

export function CountBadge({ kind, fallback = 0, className, testId }: { kind: 'messages' | 'notifications'; fallback?: number; className?: string; testId?: string }) {
  const n = useCount(kind, fallback);
  if (n <= 0) return null;
  return (
    <span
      className={className ?? 'inline-grid min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-[11px] font-bold leading-5 text-white'}
      data-testid={testId ?? (kind === 'messages' ? 'unread-badge' : 'notif-badge')}
      aria-hidden
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** Icon link with a live badge and a spoken label that includes the count. */
export function LiveIconLink({
  href,
  kind,
  fallback = 0,
  label,
  className,
  showLabel,
  testId,
  icon,
}: {
  href: string;
  kind: 'messages' | 'notifications';
  fallback?: number;
  label?: string;
  className?: string;
  showLabel?: boolean;
  testId?: string;
  icon?: ReactNode;
}) {
  const n = useCount(kind, fallback);
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  const aria = kind === 'messages' ? messagesLabel(n) : notificationsLabel(n);
  return (
    <Link href={href} aria-label={aria} aria-current={active ? 'page' : undefined} className={className} data-testid={testId}>
      <span className="relative inline-flex">
        {icon ?? (kind === 'messages' ? <MessageSquareText className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />)}
        {n > 0 && (
          <span className="absolute -top-1.5 -end-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white" data-testid={kind === 'messages' ? 'nav-unread-messages' : 'nav-unread-notifications'} aria-hidden>
            {n > 99 ? '99+' : n}
          </span>
        )}
      </span>
      {showLabel && <span aria-hidden>{label ?? (kind === 'messages' ? 'الرسائل' : 'الإشعارات')}</span>}
    </Link>
  );
}

/** Inbox pages: re-render the server list (no page reload) when the conversation set / unread count changes. */
export function InboxAutoRefresh() {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const version = useContext(InboxCtx);
  useEffect(() => {
    if (!version) return;
    if (last.current && last.current !== version) router.refresh();
    last.current = version;
  }, [version, router]);
  return null;
}
