const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

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

/** Site-wide Organization + WebSite (with on-site search) — only facts that exist (no fabricated contact data). */
export function siteJsonLd(opts: { legalName?: string; email?: string; phone?: string; sameAs?: string[] } = {}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${APP_URL}/#organization`,
        name: 'اضمن | EDMN',
        url: `${APP_URL}/`,
        logo: `${APP_URL}/brand/edmn-logo.png`,
        ...(opts.legalName ? { legalName: opts.legalName } : {}),
        ...(opts.email || opts.phone ? { contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'EG', availableLanguage: ['ar'], ...(opts.email ? { email: opts.email } : {}), ...(opts.phone ? { telephone: opts.phone } : {}) }] } : {}),
        ...(opts.sameAs?.length ? { sameAs: opts.sameAs } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${APP_URL}/#website`,
        url: `${APP_URL}/`,
        name: 'اضمن | EDMN',
        inLanguage: 'ar-EG',
        publisher: { '@id': `${APP_URL}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: `${APP_URL}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
    ],
  };
}
