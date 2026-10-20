'use client';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <h1>حصلت مشكلة غير متوقعة</h1>
          {error.digest && <p style={{ fontSize: 12, color: '#64748b' }}>ref: {error.digest}</p>}
          <button onClick={reset} style={{ padding: '8px 16px' }}>جرّب تاني</button>
        </div>
      </body>
    </html>
  );
}
