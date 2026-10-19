import { BadgeCheck, Check, CircleAlert, FileSearch, Fingerprint, Info, ScanSearch, ShieldCheck, ShieldHalf, X } from 'lucide-react';
import Link from '@/ui/link';
import { cn } from '@/lib/cn';
import { mediaUrl } from '@/ui/commerce';
import {
  coverage,
  PROTECTION_LEVEL_LABELS,
  PROTECTION_LEVEL_SUMMARY,
  SAFETY_SCORE_DISCLAIMER,
  USED_FIELD_GROUP_LABELS,
  USED_FIELD_GROUPS,
  type Defect,
  type ProtectionLevel,
  type SafetyScore,
} from '@/domain/used';
import type { Signal } from '@/server/modules/used/signals';

/**
 * Trusted Used Commerce building blocks. Wording rule: describe exactly what was checked — never «مضمون 100%»,
 * never an inspection that did not happen, never a probability of success.
 */

const LEVEL_STYLE: Record<ProtectionLevel, { icon: typeof ShieldCheck; cls: string }> = {
  PROTECTED: { icon: ShieldHalf, cls: 'bg-brand-50 text-brand-800 ring-brand-200' },
  VERIFIED: { icon: BadgeCheck, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  INSPECTED: { icon: ScanSearch, cls: 'bg-brand-950 text-white ring-brand-800' },
};

export function ProtectionLevelBadge({ level, className }: { level: ProtectionLevel; className?: string }) {
  const s = LEVEL_STYLE[level];
  return (
    <span data-testid="protection-level" data-level={level} className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1', s.cls, className)}>
      <s.icon className="size-4" aria-hidden />
      {PROTECTION_LEVEL_LABELS[level]}
    </span>
  );
}

/** The four protections, each stated separately (transaction ≠ condition review ≠ inspection ≠ warranty). */
export function CoverageList({ level, warranty, className }: { level: ProtectionLevel; warranty?: string | null; className?: string }) {
  return (
    <ul data-testid="coverage" className={cn('space-y-2', className)}>
      {coverage(level, warranty).map((c) => (
        <li key={c.key} data-covered={c.covered} className="flex items-start gap-2.5 text-sm">
          <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', c.covered ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500')}>
            {c.covered ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="font-semibold text-ink">{c.title}: </span>
            <span className="text-muted">{c.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const SCORE_TONE = { HIGH: 'text-emerald-700 bg-emerald-50 ring-emerald-200', MEDIUM: 'text-brand-800 bg-brand-50 ring-brand-200', LOW: 'text-slate-700 bg-slate-100 ring-slate-200' } as const;

/** «مؤشر أمان الصفقة» — score, level, and the per-factor explanation (no JavaScript needed). */
export function SafetyScoreCard({ score, className }: { score: SafetyScore; className?: string }) {
  return (
    <section data-testid="safety-score" data-score={score.score} aria-labelledby="safety-title" className={cn('card p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="safety-title" className="text-sm font-bold text-ink">مؤشر أمان الصفقة</h3>
        <span className={cn('inline-flex items-baseline gap-1 rounded-full px-3 py-1 text-sm font-bold ring-1', SCORE_TONE[score.level])}>
          <span className="ltr text-lg" dir="ltr">{score.score}<span className="text-xs">/100</span></span>
          <span className="text-xs">— {score.levelLabel}</span>
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className={cn('h-full rounded-full', score.level === 'HIGH' ? 'bg-emerald-500' : score.level === 'MEDIUM' ? 'bg-brand-500' : 'bg-slate-400')} style={{ width: `${score.score}%` }} />
      </div>
      <details className="group mt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
          <Info className="size-4" aria-hidden />
          لماذا حصلت الصفقة على هذه الدرجة؟
        </summary>
        <ul className="mt-2 divide-y divide-line text-sm">
          {score.factors.map((f) => (
            <li key={f.factor} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{f.label}</span>
                <span className="block text-xs text-muted">{f.why}</span>
              </span>
              <span className="ltr shrink-0 text-xs font-bold text-muted">{f.applicable ? `${f.earned}/${f.max}` : 'لا ينطبق'}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-2 text-xs leading-5 text-muted">{SAFETY_SCORE_DISCLAIMER}</p>
    </section>
  );
}

export function SellerSignalsCard({ signals, className }: { signals: Signal[]; className?: string }) {
  return (
    <section data-testid="seller-signals" aria-labelledby="signals-title" className={cn('card p-4', className)}>
      <h3 id="signals-title" className="text-sm font-bold text-ink">مؤشرات البائع</h3>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {signals.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-2 border-b border-line/70 pb-1.5">
            <dt className="text-muted">{s.label}</dt>
            <dd className={cn('font-semibold', s.good === true ? 'text-emerald-700' : 'text-ink')}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">مؤشرات مبنية على عمليات البائع على اضمن فقط. مفيش شارة «بائع موثوق» عامة — كل مؤشر بيقول هو مبني على إيه.</p>
    </section>
  );
}

export type ConditionField = { code: string; group: string; label: string; display: string };
export type EvidenceItem = { slot: string; label: string; fileId: string; storageKey?: string | null; private: boolean };

/** Structured condition: grouped fields, declared defects, masked identifier, evidence (private files only when allowed). */
export function ConditionDetails({
  fields,
  defects,
  identifierMasked,
  evidence,
  showPrivate,
  className,
}: {
  fields: ConditionField[];
  defects: Defect[];
  identifierMasked: string | null;
  evidence: EvidenceItem[];
  showPrivate: boolean;
  className?: string;
}) {
  const groups = USED_FIELD_GROUPS.map((g) => ({ g, items: fields.filter((f) => f.group === g && f.display !== '—') })).filter((x) => x.items.length);
  const visibleEvidence = evidence.filter((e) => showPrivate || !e.private);
  return (
    <div data-testid="condition-details" className={cn('space-y-4', className)}>
      {identifierMasked && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Fingerprint className="size-4 text-brand-700" aria-hidden />
          <span className="font-semibold">IMEI / الرقم التسلسلي:</span>
          <span data-testid="masked-identifier" className="ltr rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs tracking-wider">{identifierMasked}</span>
          <span className="text-xs text-muted">(الرقم الكامل محفوظ متشفّر ومش بيظهر للعامة)</span>
        </p>
      )}
      <div className={cn('rounded-2xl p-4 ring-1', defects.length ? 'bg-amber-50 ring-amber-200' : 'bg-emerald-50 ring-emerald-200')}>
        <p className="flex items-center gap-2 text-sm font-bold">
          <CircleAlert className={cn('size-4', defects.length ? 'text-amber-700' : 'text-emerald-700')} aria-hidden />
          {defects.length ? `عيوب معلنة من البائع (${defects.length})` : 'البائع ما أعلنش عن عيوب'}
        </p>
        {defects.length > 0 && (
          <ul data-testid="declared-defects" className="mt-2 space-y-1 text-sm">
            {defects.map((d) => (
              <li key={d.code + d.detail}>
                <span className="font-semibold">{d.label}:</span> {d.detail}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">العيب المعلن قبل الشراء جزء من الوصف ومش سبب لنزاع. أي عيب مش معلن من حقك تفتح عليه نزاع خلال فترة الفحص.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(({ g, items }) => (
          <div key={g} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-line">
            <p className="mb-1.5 text-xs font-bold text-muted">{USED_FIELD_GROUP_LABELS[g]}</p>
            <dl className="space-y-1 text-sm">
              {items.map((f) => (
                <div key={f.code} className="flex justify-between gap-3">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="text-end font-semibold">{f.display}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {visibleEvidence.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold">صور التوثيق</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {visibleEvidence.map((e) => {
              const src = e.private ? `/api/files/${e.fileId}` : (mediaUrl(e.storageKey, 'thumb') ?? '');
              return (
                <li key={e.fileId}>
                  <a href={e.private ? `/api/files/${e.fileId}` : (mediaUrl(e.storageKey) ?? '#')} target="_blank" rel="noopener" className="block overflow-hidden rounded-xl ring-1 ring-line hover:ring-brand-400">
                    <img src={src} alt={e.label} loading="lazy" className="aspect-square w-full bg-slate-50 object-cover" />
                    <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{e.label}{e.private ? ' 🔒' : ''}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Compact entry point to a Product Passport. */
export function PassportLink({ code, level, className }: { code: string; level: ProtectionLevel; className?: string }) {
  return (
    <Link href={`/passport/${code}`} data-testid="passport-link" className={cn('flex min-h-11 items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line transition hover:ring-brand-400', className)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-950 text-white">
        <FileSearch className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">جواز المنتج من اضمن</span>
        <span className="ltr block text-xs text-muted">{code}</span>
      </span>
      <ProtectionLevelBadge level={level} />
    </Link>
  );
}

export function LevelExplainer({ level }: { level: ProtectionLevel }) {
  return <p className="text-sm leading-6 text-muted">{PROTECTION_LEVEL_SUMMARY[level]}</p>;
}
