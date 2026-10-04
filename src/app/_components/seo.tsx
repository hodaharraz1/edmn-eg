const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Structured data (schema.org). Only real values are emitted — never fabricated ratings/availability. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: new URL(it.url, APP_URL).toString() })),
  };
}

export function absoluteUrl(path: string) {
  return new URL(path, APP_URL).toString();
}
