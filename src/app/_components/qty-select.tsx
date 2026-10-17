'use client';

/** Quantity selector that submits its form on change (falls back to the update button without JS). */
export function QtySelect({ value, max, name = 'quantity' }: { value: number; max: number; name?: string }) {
  const opts = Array.from({ length: Math.max(value, Math.min(max, 20)) }, (_, i) => i + 1);
  return (
    <select
      name={name}
      defaultValue={value}
      aria-label="الكمية"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
    >
      {opts.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
