'use client';

import { Check, Copy, ImagePlus, Minus, Plus, X, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Image gallery with thumbnails and an accessible zoom dialog. */
export function Gallery({ images, alt }: { images: { src: string; full: string; actual?: boolean }[]; alt: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (zoom) dialog.current?.showModal();
    else dialog.current?.close();
  }, [zoom]);
  if (!images.length) return <div className="card grid aspect-square place-items-center text-muted">مفيش صور</div>;
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setZoom(true)} className="card group relative block aspect-square w-full overflow-hidden bg-white" aria-label="تكبير الصورة">
        <img src={cur.src} alt={alt} className="size-full object-contain transition-transform duration-300 group-hover:scale-105" />
        {cur.actual && <span className="absolute top-3 start-3 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-amber-950">صورة حقيقية للقطعة</span>}
        <span className="absolute bottom-3 end-3 grid size-9 place-items-center rounded-full bg-white/90 shadow">
          <ZoomIn className="size-4" />
        </span>
      </button>
      {images.length > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {images.map((im, idx) => (
            <button
              type="button"
              key={idx}
              onClick={() => setI(idx)}
              aria-label={`صورة ${idx + 1}`}
              aria-current={idx === i}
              className={cn('relative size-16 shrink-0 overflow-hidden rounded-lg border-2 bg-white', idx === i ? 'border-brand-600' : 'border-line')}
            >
              <img src={im.src} alt="" className="size-full object-cover" loading="lazy" />
              {im.actual && <span className="absolute bottom-0 inset-x-0 bg-amber-400 text-[9px] font-bold text-amber-950">حقيقية</span>}
            </button>
          ))}
        </div>
      )}
      <dialog ref={dialog} onClose={() => setZoom(false)} className="m-auto max-h-[92vh] w-[min(96vw,1000px)] rounded-2xl bg-white p-0">
        <div className="relative">
          <button type="button" onClick={() => setZoom(false)} className="absolute top-3 end-3 z-10 grid size-9 place-items-center rounded-full bg-white shadow" aria-label="إغلاق">
            <X className="size-5" />
          </button>
          <img src={cur.full} alt={alt} className="max-h-[90vh] w-full object-contain" />
        </div>
      </dialog>
    </div>
  );
}

/** File picker with previews and client-side size/type hints (server re-validates everything). */
export function FileInput({ name, accept = 'image/jpeg,image/png,image/webp', multiple, label, hint, required, maxMb = 8 }: { name: string; accept?: string; multiple?: boolean; label: ReactNode; hint?: ReactNode; required?: boolean; maxMb?: number }) {
  const [files, setFiles] = useState<{ name: string; url: string | null; tooBig: boolean }[]>([]);
  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), [files]);
  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-page/50 px-4 py-6 text-center text-sm hover:border-brand-400 hover:bg-brand-50/40">
        <ImagePlus className="size-6 text-brand-600" aria-hidden />
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        <input
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          required={required}
          className="sr-only"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            setFiles(list.map((f) => ({ name: f.name, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null, tooBig: f.size > maxMb * 1024 * 1024 })));
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className={cn('flex items-center gap-2 rounded-lg border bg-white p-1.5 pe-3 text-xs', f.tooBig ? 'border-red-300 text-red-700' : 'border-line')}>
              {f.url ? <img src={f.url} alt="" className="size-10 rounded object-cover" /> : <span className="grid size-10 place-items-center rounded bg-page text-[10px]">PDF</span>}
              <span className="max-w-40 truncate ltr">{f.name}</span>
              {f.tooBig && <span>أكبر من {maxMb} م.ب</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QuantityInput({ name = 'quantity', max = 99, defaultValue = 1 }: { name?: string; max?: number; defaultValue?: number }) {
  const [q, setQ] = useState(defaultValue);
  return (
    <div className="inline-flex h-10 items-center rounded-lg border border-line bg-white">
      <button type="button" className="grid size-10 place-items-center disabled:opacity-40" onClick={() => setQ((v) => Math.max(1, v - 1))} disabled={q <= 1} aria-label="قلّل">
        <Minus className="size-4" />
      </button>
      <input name={name} value={q} onChange={(e) => setQ(Math.min(max, Math.max(1, Number(e.target.value) || 1)))} inputMode="numeric" className="w-10 text-center text-sm font-semibold focus:outline-none" aria-label="الكمية" />
      <button type="button" className="grid size-10 place-items-center disabled:opacity-40" onClick={() => setQ((v) => Math.min(max, v + 1))} disabled={q >= max} aria-label="زوّد">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function CopyButton({ value, label = 'انسخ' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs hover:bg-page"
    >
      {done ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {done ? 'اتنسخ' : label}
    </button>
  );
}

/** Mobile drawer (e.g. filters/menu) built on <dialog>. */
export function Drawer({ trigger, title, children }: { trigger: ReactNode; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <span onClick={() => ref.current?.showModal()}>{trigger}</span>
      <dialog ref={ref} className="ms-auto me-0 my-0 h-dvh max-h-dvh w-[min(88vw,380px)] bg-white p-0 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={() => ref.current?.close()} className="grid size-9 place-items-center rounded-full hover:bg-page" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4" onClick={(e) => (e.target as HTMLElement).closest('a') && ref.current?.close()}>
          {children}
        </div>
      </dialog>
    </>
  );
}

/** Stores recently viewed product ids in localStorage (client-only, no tracking server-side). */
export function RecordRecentlyViewed({ id }: { id: string }) {
  useEffect(() => {
    try {
      const key = 'edmn_recent';
      const list: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
      localStorage.setItem(key, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 12)));
    } catch {
      /* storage disabled */
    }
  }, [id]);
  return null;
}
