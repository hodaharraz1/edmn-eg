'use client';

import { useState } from 'react';
import { Crosshair, MapPin, PenLine, X } from 'lucide-react';
import { Field, Input, Select, Textarea } from '@/ui/form';

type Gov = { id: number; nameAr: string };
export type LocationDefaults = Partial<{ governorateId: number; city: string; street: string; building: string; floor: string; apartment: string; landmark: string; notes: string }>;
type Gps = { lat: number; lng: number; accuracy: number };
type State = { kind: 'idle' } | { kind: 'asking' } | { kind: 'ok'; gps: Gps } | { kind: 'error'; message: string };

/** Above this accuracy (metres) the pin is too vague to be useful; the written address still works. */
const MAX_USEFUL_ACCURACY_M = 1000;

/**
 * Address entry with OPTIONAL "use my current location".
 * - Location is requested only when the user clicks the button (explicit browser permission prompt).
 * - One reading only: no watchPosition, no background tracking.
 * - Denied / unsupported / unavailable / inaccurate → a clear message, and the manual address keeps working.
 * - Coordinates live only in hidden form fields of this form (never in the URL) and are encrypted server-side.
 * - Map pin: provider abstraction (src/ui/map/provider.ts); no provider or API key is configured yet.
 */
export function LocationPicker({ prefix = 'loc_', governorates, defaults, title = 'تحديد موقع الاستلام' }: { prefix?: string; governorates: Gov[]; defaults?: LocationDefaults; title?: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const mapProvider = process.env.NEXT_PUBLIC_MAP_PROVIDER;
  const gps = state.kind === 'ok' ? state.gps : null;

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState({ kind: 'error', message: 'المتصفح لا يدعم تحديد الموقع. أدخل العنوان يدوياً.' });
      return;
    }
    setState({ kind: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        if (g.accuracy > MAX_USEFUL_ACCURACY_M) {
          setState({ kind: 'error', message: `دقة الموقع منخفضة (حوالي ${g.accuracy} متر) فلم نحفظه. أدخل العنوان يدوياً.` });
          return;
        }
        setState({ kind: 'ok', gps: g });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'لم يتم السماح بالوصول للموقع. لا مشكلة — أدخل العنوان يدوياً.'
            : err.code === err.TIMEOUT
              ? 'استغرق تحديد الموقع وقتاً طويلاً. أدخل العنوان يدوياً أو حاول مرة أخرى.'
              : 'تعذر تحديد الموقع حالياً. أدخل العنوان يدوياً.';
        setState({ kind: 'error', message });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-4" data-testid="location-picker">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useMyLocation} disabled={state.kind === 'asking'} className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-60">
          <Crosshair className="size-4" aria-hidden /> {state.kind === 'asking' ? 'جارٍ تحديد موقعك…' : 'استخدام موقعي الحالي'}
        </button>
        <span className="inline-flex items-center gap-1 text-xs text-muted"><PenLine className="size-3.5" aria-hidden /> أو أدخل العنوان يدوياً بالأسفل</span>
      </div>
      <p className="text-xs text-muted">نطلب الموقع مرة واحدة فقط عند الضغط على الزر وبعد موافقتك، ولا نتتبعك. الموقع يظهر فقط لطرف الصفقة في المرحلة المناسبة ولفريق التشغيل المختص.</p>
      <div role="status" aria-live="polite">
        {gps && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900" data-testid="location-ok">
            <MapPin className="size-4" aria-hidden /> تم تحديد موقعك (دقة تقريبية {gps.accuracy} متر). أكمل العنوان المكتوب — الموقع لا يغني عن العنوان.
            <button type="button" onClick={() => setState({ kind: 'idle' })} className="inline-flex items-center gap-1 underline"><X className="size-3" aria-hidden /> إزالة الموقع</button>
          </p>
        )}
        {state.kind === 'error' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900" data-testid="location-error">{state.message}</p>}
      </div>
      <input type="hidden" name={`${prefix}lat`} value={gps ? String(gps.lat) : ''} />
      <input type="hidden" name={`${prefix}lng`} value={gps ? String(gps.lng) : ''} />
      <input type="hidden" name={`${prefix}accuracy`} value={gps ? String(gps.accuracy) : ''} />
      {mapProvider ? (
        <div data-map-provider={mapProvider} className="h-48 rounded-lg border border-dashed border-line text-center text-xs text-muted">تحديد الدبوس على الخريطة</div>
      ) : (
        <p className="text-[11px] text-muted">تحديد الدبوس على الخريطة سيتوفر عند تفعيل مزود خرائط معتمد.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المحافظة" htmlFor={`${prefix}governorateId`} required>
          <Select id={`${prefix}governorateId`} name={`${prefix}governorateId`} defaultValue={defaults?.governorateId ?? ''} required>
            <option value="" disabled>اختر المحافظة</option>
            {governorates.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}
          </Select>
        </Field>
        <Field label="المدينة / المنطقة" htmlFor={`${prefix}city`} required><Input id={`${prefix}city`} name={`${prefix}city`} defaultValue={defaults?.city} required minLength={2} /></Field>
      </div>
      <Field label="الشارع" htmlFor={`${prefix}street`} required><Input id={`${prefix}street`} name={`${prefix}street`} defaultValue={defaults?.street} required minLength={2} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="العمارة" htmlFor={`${prefix}building`}><Input id={`${prefix}building`} name={`${prefix}building`} defaultValue={defaults?.building} /></Field>
        <Field label="الدور" htmlFor={`${prefix}floor`}><Input id={`${prefix}floor`} name={`${prefix}floor`} defaultValue={defaults?.floor} /></Field>
        <Field label="الشقة" htmlFor={`${prefix}apartment`}><Input id={`${prefix}apartment`} name={`${prefix}apartment`} defaultValue={defaults?.apartment} /></Field>
      </div>
      <Field label="علامة مميزة" htmlFor={`${prefix}landmark`}><Input id={`${prefix}landmark`} name={`${prefix}landmark`} defaultValue={defaults?.landmark} placeholder="بجوار…" /></Field>
      <Field label="ملاحظات للتسليم" htmlFor={`${prefix}notes`}><Textarea id={`${prefix}notes`} name={`${prefix}notes`} rows={2} defaultValue={defaults?.notes} /></Field>
    </fieldset>
  );
}
