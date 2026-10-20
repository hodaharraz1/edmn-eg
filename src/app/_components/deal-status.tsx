import { Ban, BadgeCheck, Check, CircleDollarSign, FileSignature, Handshake, Hourglass, KeyRound, Landmark, LockKeyhole, type LucideIcon, PackageCheck, RotateCcw, Scale, SearchCheck, ShieldCheck, Truck, Undo2 } from 'lucide-react';
import type { DealStatus } from '@/domain/machines';
import { cn } from '@/lib/cn';

type Role = 'BUYER' | 'SELLER';
type Actor = Role | 'EDMN' | 'NONE';
type Money = 'NONE' | 'REVIEW' | 'HELD' | 'FROZEN' | 'REFUNDING' | 'REFUNDED' | 'RELEASED';

/**
 * One entry per real dealMachine status (src/domain/machines.ts): what happened, who acts next, and where the
 * money is. Display only — every action stays in the page's existing forms. Never carries the receipt code.
 */
const STATES: Record<DealStatus, { icon: LucideIcon; title: string; actor: Actor; money: Money; next: Partial<Record<Role | 'ANY', string>> }> = {
  DRAFT: { icon: FileSignature, title: 'طلب الصفقة لسه مكملش', actor: 'BUYER', money: 'NONE', next: { BUYER: 'كمّل تفاصيل الطلب وابعت الدعوة للبائع.' } },
  INVITED: { icon: Handshake, title: 'الدعوة اتبعتت للبائع', actor: 'SELLER', money: 'NONE', next: { BUYER: 'مستنيين البائع يدخل من رابط الدعوة.', SELLER: 'ادخل الصفقة وابعت عرضك.' } },
  SELLER_JOINED: { icon: Handshake, title: 'البائع دخل الصفقة', actor: 'SELLER', money: 'NONE', next: { BUYER: 'البائع بيجهّز عرضه (السعر والشحن وسياسة الإرجاع).', SELLER: 'اكتب بياناتك وابعت عرضك للمشتري.' } },
  OFFER_PENDING_BUYER: { icon: FileSignature, title: 'عرض البائع مستني رد المشتري', actor: 'BUYER', money: 'NONE', next: { BUYER: 'راجع العرض: وافق، أو اطلب تعديل، أو ارفض.', SELLER: 'مستنيين المشتري يراجع عرضك.' } },
  CHANGE_REQUESTED: { icon: FileSignature, title: 'المشتري طلب تعديل على العرض', actor: 'SELLER', money: 'NONE', next: { BUYER: 'مستنيين رد البائع على طلب التعديل.', SELLER: 'اقبل التعديل أو ارفضه أو ابعت عرض مقابل.' } },
  ACCEPTED: { icon: BadgeCheck, title: 'الطرفين اتفقوا على الشروط', actor: 'BUYER', money: 'NONE', next: { BUYER: 'اختار طريقة الدفع لحساب اضمن.', SELLER: 'مستنيين المشتري يدفع لحساب اضمن.' } },
  PAYMENT_PENDING: { icon: Landmark, title: 'في انتظار الدفع لحساب اضمن', actor: 'BUYER', money: 'NONE', next: { BUYER: 'حوّل المبلغ لحسابات اضمن الظاهرة هنا بس، وارفع إثبات التحويل.', SELLER: 'مستنيين المشتري يدفع. ما تشحنش قبل ما اضمن يأكد الدفع.' } },
  PAYMENT_UNDER_REVIEW: { icon: SearchCheck, title: 'إثبات الدفع تحت المراجعة', actor: 'EDMN', money: 'REVIEW', next: { ANY: 'فريق اضمن بيراجع التحويل يدويًا، وهيبلغكم بالنتيجة.' } },
  ACTIVE: { icon: ShieldCheck, title: 'الدفع اتأكد والصفقة شغالة', actor: 'SELLER', money: 'HELD', next: { BUYER: 'البائع بيجهّز المنتج ويشحنه حسب الاتفاق.', SELLER: 'اشحن المنتج حسب الاتفاق وسجّل الشحن.' } },
  DELIVERED: { icon: Truck, title: 'المنتج في الطريق للتسليم', actor: 'SELLER', money: 'HELD', next: { BUYER: 'وقت ما تستلم المنتج فعلًا، ادّي رمز الاستلام للبائع أو المندوب.', SELLER: 'وقت التسليم اطلب رمز الاستلام من المشتري واكتبه هنا.' } },
  DELIVERY_HANDOVER_VERIFIED: { icon: PackageCheck, title: 'التسليم اتأكد برمز الاستلام', actor: 'BUYER', money: 'HELD', next: { BUYER: 'افحص المنتج وأكّد إنه مطابق، أو بلّغ عن مشكلة قبل نهاية المهلة.', SELLER: 'مستنيين المشتري يفحص المنتج ويأكد.' } },
  BUYER_CONFIRMATION_PENDING: { icon: Hourglass, title: 'في انتظار تأكيد المشتري', actor: 'BUYER', money: 'HELD', next: { BUYER: 'أكّد إن المنتج مطابق، أو بلّغ عن مشكلة قبل نهاية المهلة.', SELLER: 'مستنيين المشتري يأكد إن المنتج مطابق.' } },
  BUYER_CONFIRMED_RECEIPT: { icon: BadgeCheck, title: 'المشتري أكد إن المنتج مطابق', actor: 'EDMN', money: 'HELD', next: { ANY: 'الإدارة بتراجع وتوافق على إتاحة المبلغ للبائع.' } },
  ENTITLED_AWAITING_RELEASE: { icon: BadgeCheck, title: 'مهلة الفحص خلصت بدون اعتراض', actor: 'EDMN', money: 'HELD', next: { ANY: 'الإدارة بتراجع وتوافق على إتاحة المبلغ للبائع.' } },
  COMPLETED: { icon: CircleDollarSign, title: 'الصفقة خلصت', actor: 'NONE', money: 'RELEASED', next: {} },
  DISPUTED: { icon: Scale, title: 'فيه نزاع مفتوح على الصفقة', actor: 'EDMN', money: 'FROZEN', next: { ANY: 'فريق اضمن بيراجع أدلة الطرفين ويقرر. تابع النزاع وردّ على أي طلب معلومات.' } },
  REFUND_PENDING: { icon: RotateCcw, title: 'قرار النزاع: استرداد للمشتري', actor: 'EDMN', money: 'REFUNDING', next: { ANY: 'الإدارة بتعتمد الاسترداد قبل التحويل للمشتري.' } },
  CANCELLED: { icon: Ban, title: 'الصفقة اتلغت', actor: 'NONE', money: 'NONE', next: {} },
  REFUNDED: { icon: Undo2, title: 'المبلغ اترد للمشتري', actor: 'NONE', money: 'REFUNDED', next: {} },
};

const MONEY: Record<Money, { text: string; protectedNow: boolean }> = {
  NONE: { text: 'مفيش أي مبلغ اتدفع في الصفقة دي لحد دلوقتي.', protectedNow: false },
  REVIEW: { text: 'إثبات تحويلك عند اضمن للمراجعة. الحماية بتبدأ أول ما الدفع يتأكد.', protectedNow: false },
  HELD: { text: 'المبلغ محفوظ لدى اضمن، ومش بيتاح للبائع غير بعد التأكيد وموافقة الإدارة.', protectedNow: true },
  FROZEN: { text: 'المبلغ متجمّد لدى اضمن لحد قرار النزاع.', protectedNow: true },
  REFUNDING: { text: 'المبلغ لسه لدى اضمن لحد ما الاسترداد يتعتمد ويتحوّل للمشتري.', protectedNow: true },
  REFUNDED: { text: 'المبلغ اترد للمشتري.', protectedNow: false },
  RELEASED: { text: 'المبلغ اتاح للبائع بعد موافقة الإدارة.', protectedNow: false },
};

/** Main path of a deal (off-path states — dispute, refund, cancellation — show no "current" step). */
const STAGES: { label: string; icon: LucideIcon; statuses: DealStatus[] }[] = [
  { label: 'الاتفاق', icon: FileSignature, statuses: ['DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED'] },
  { label: 'الدفع لاضمن', icon: Landmark, statuses: ['PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW'] },
  { label: 'الشحن والتسليم', icon: KeyRound, statuses: ['ACTIVE', 'DELIVERED'] },
  { label: 'الفحص والتأكيد', icon: PackageCheck, statuses: ['DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING'] },
  { label: 'موافقة الإدارة', icon: LockKeyhole, statuses: ['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE'] },
  { label: 'إتاحة المبلغ', icon: CircleDollarSign, statuses: ['COMPLETED'] },
];

function actorLabel(actor: Actor, role: Role) {
  if (actor === 'EDMN') return 'فريق اضمن';
  if (actor === 'NONE') return null;
  if (actor === role) return 'عليك انت';
  return actor === 'BUYER' ? 'المشتري' : 'البائع';
}

export function DealStatusPanel({ status, role, openDispute }: { status: DealStatus; role: Role; openDispute?: boolean }) {
  // An open dispute holds the money whatever the deal's own status says.
  const s = STATES[status];
  const frozen = openDispute && s.money === 'HELD';
  const money = MONEY[frozen ? 'FROZEN' : s.money];
  const next = frozen ? 'فيه نزاع مفتوح: فريق اضمن بيراجع ويقرر قبل أي خطوة على المبلغ.' : (s.next[role] ?? s.next.ANY);
  const who = actorLabel(frozen ? 'EDMN' : s.actor, role);
  const stage = STAGES.findIndex((x) => x.statuses.includes(status));
  const Icon = s.icon;
  return (
    <section aria-labelledby="deal-status-title" data-testid="deal-status-panel" className="relative isolate overflow-hidden rounded-2xl bg-brand-950 p-5 text-white shadow-[var(--shadow-pop)] sm:p-6">
      <div aria-hidden className="absolute -left-16 -top-16 -z-10 size-56 rounded-full bg-brand-500/30 blur-3xl" />
      <div className="flex items-start gap-4">
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ring-white/20', status === 'DISPUTED' || frozen ? 'bg-amber-500' : status === 'CANCELLED' ? 'bg-white/15' : 'bg-gradient-to-br from-brand-400 to-brand-700')}>
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold text-brand-100/80">حالة الصفقة</p>
          <h2 id="deal-status-title" className="text-lg font-bold leading-7 sm:text-xl">{s.title}</h2>
          {who && (
            <p className="inline-flex rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-sky-200 ring-1 ring-white/15" data-testid="deal-status-actor">
              الدور على: {who}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className={cn('rounded-xl p-3 ring-1', money.protectedNow ? 'bg-emerald-400/10 ring-emerald-300/30' : 'bg-white/[0.06] ring-white/10')}>
          <dt className="flex items-center gap-1.5 text-xs font-bold text-white/70">
            <ShieldCheck className={cn('size-4', money.protectedNow ? 'text-emerald-300' : 'text-white/60')} aria-hidden /> المبلغ فين؟
          </dt>
          <dd className="mt-1 text-sm leading-6" data-testid="deal-money-state">{money.text}</dd>
        </div>
        {next && (
          <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
            <dt className="text-xs font-bold text-white/70">الخطوة الجاية</dt>
            <dd className="mt-1 text-sm leading-6">{next}</dd>
          </div>
        )}
      </dl>

      {stage >= 0 && (
        <ol aria-label="مراحل الصفقة" className="mt-5 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
          {STAGES.map((st, i) => {
            const state = i < stage || status === 'COMPLETED' ? 'done' : i === stage ? 'current' : 'next';
            return (
              <li key={st.label} aria-current={state === 'current' ? 'step' : undefined} className="flex flex-col items-center gap-1.5 text-center">
                <span className={cn('grid size-9 place-items-center rounded-full', state === 'done' ? 'bg-emerald-500' : state === 'current' ? 'bg-white text-brand-800 ring-4 ring-brand-400/50' : 'bg-white/10 text-white/60')}>
                  {state === 'done' ? <Check className="size-4" aria-hidden /> : <st.icon className="size-4" aria-hidden />}
                </span>
                <span className={cn('text-[11px] font-semibold leading-4 sm:text-xs', state === 'next' ? 'text-white/60' : 'text-white')}>
                  {st.label}
                  <span className="sr-only">{state === 'done' ? ' (خلصت)' : state === 'current' ? ' (المرحلة الحالية)' : ''}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Compact "who acts next" line for deal lists. */
export function DealTurn({ status, role }: { status: DealStatus; role: Role }) {
  const s = STATES[status];
  const who = actorLabel(s.actor, role);
  if (!who) return null;
  const mine = s.actor === role;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', mine ? 'bg-brand-600 text-white' : 'bg-soft text-brand-800')}>
      الدور على: {who}
    </span>
  );
}
