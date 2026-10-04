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
      className="h-9 rounded-lg border border-line bg-white px-2 text-sm"
    >
      {opts.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
