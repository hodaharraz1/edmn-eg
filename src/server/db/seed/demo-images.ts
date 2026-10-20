import sharp from 'sharp';

const PALETTE = [
  ['#0f4c81', '#4f9bd9'],
  ['#14532d', '#4ade80'],
  ['#7c2d12', '#fb923c'],
  ['#4c1d95', '#a78bfa'],
  ['#831843', '#f472b6'],
  ['#1e293b', '#94a3b8'],
  ['#713f12', '#facc15'],
  ['#134e4a', '#2dd4bf'],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

const ICONS: Record<string, string> = {
  phone: '<rect x="320" y="180" width="160" height="300" rx="24" fill="#fff" opacity=".92"/><rect x="335" y="205" width="130" height="235" rx="8" fill="#111827" opacity=".85"/><circle cx="400" cy="460" r="10" fill="#111827" opacity=".5"/>',
  laptop: '<rect x="250" y="220" width="300" height="190" rx="12" fill="#fff" opacity=".92"/><rect x="265" y="235" width="270" height="160" fill="#111827" opacity=".85"/><path d="M210 420h380l-30 40H240z" fill="#fff" opacity=".9"/>',
  tv: '<rect x="200" y="200" width="400" height="240" rx="10" fill="#111827" opacity=".9"/><rect x="215" y="215" width="370" height="210" fill="#fff" opacity=".25"/><rect x="380" y="440" width="40" height="30" fill="#fff" opacity=".8"/><rect x="320" y="468" width="160" height="10" rx="5" fill="#fff" opacity=".8"/>',
  shirt: '<path d="M300 200l-90 60 40 70 50-30v200h200V300l50 30 40-70-90-60c-10 30-40 50-100 50s-90-20-100-50z" fill="#fff" opacity=".92"/>',
  shoe: '<path d="M200 420c0-40 20-120 60-130 40 50 90 70 160 80 80 10 140 20 170 60v40H200z" fill="#fff" opacity=".92"/>',
  appliance: '<rect x="290" y="170" width="220" height="320" rx="16" fill="#fff" opacity=".92"/><circle cx="400" cy="350" r="80" fill="#111827" opacity=".75"/><circle cx="400" cy="350" r="55" fill="#fff" opacity=".35"/><rect x="310" y="195" width="80" height="18" rx="9" fill="#111827" opacity=".5"/>',
  home: '<path d="M400 190l170 140v170H230V330z" fill="#fff" opacity=".92"/><rect x="370" y="400" width="60" height="100" fill="#111827" opacity=".7"/>',
  beauty: '<rect x="350" y="170" width="100" height="60" rx="10" fill="#fff" opacity=".8"/><rect x="310" y="230" width="180" height="260" rx="40" fill="#fff" opacity=".92"/>',
  box: '<path d="M240 260l160-80 160 80v200l-160 80-160-80z" fill="#fff" opacity=".9"/><path d="M240 260l160 80 160-80M400 340v200" stroke="#111827" stroke-width="6" fill="none" opacity=".5"/>',
};

/** Deterministic illustrative product image (development/demo only — no real product photography). */
export async function demoImage(label: string, icon: keyof typeof ICONS, variant = 0): Promise<Buffer> {
  const [a, b] = PALETTE[(hash(label) + variant) % PALETTE.length];
  const safe = label.replace(/[<>&"]/g, '').slice(0, 32);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="800" height="800" fill="url(#g)"/>
    <circle cx="${620 - variant * 40}" cy="${160 + variant * 30}" r="140" fill="#fff" opacity=".08"/>
    ${ICONS[icon]}
    <text x="400" y="640" font-family="DejaVu Sans" font-size="40" font-weight="bold" fill="#fff" text-anchor="middle">${safe}</text>
    ${variant > 0 ? `<text x="400" y="700" font-family="DejaVu Sans" font-size="26" fill="#fff" opacity=".85" text-anchor="middle">Actual item photo ${variant}</text>` : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function demoDocument(label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" rx="24" fill="#e5e7eb"/>
    <rect x="40" y="40" width="220" height="280" rx="12" fill="#9ca3af"/>
    <text x="460" y="120" font-family="DejaVu Sans" font-size="34" fill="#111827">DEMO DOCUMENT</text>
    <text x="460" y="180" font-family="DejaVu Sans" font-size="26" fill="#374151">${label.replace(/[<>&"]/g, '')}</text>
    <text x="460" y="240" font-family="DejaVu Sans" font-size="22" fill="#6b7280">Not a real identity document</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
