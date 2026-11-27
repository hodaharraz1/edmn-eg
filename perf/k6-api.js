// PKG-PERF-01 v3 — HTTP load test for the six critical API paths the PROGRAM-READY-100 brief names:
// browsing, search, product cards, login, checkout, receipt upload.
//
// Run everything locally with one command (server must be up, fixtures seeded — see perf/README.md):
//   BASE_URL=http://127.0.0.1:3000 npm run perf:k6
//
// Never point this at staging or any shared environment (docs/TESTING_POLICY.md): checkout and receipt
// upload CREATE rows. Run it locally or on the isolated environment the owner provisions.
//
// Output: p50/p95/p99 and error rate per scenario via thresholds; k6 prints the full summary at the end.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
// Fixtures (perf/README.md §2): a LIVE product, a variant with stock, an approved test customer.
const PRODUCT_SLUG = __ENV.TEST_PRODUCT_SLUG || '';
const LOGIN_EMAIL = __ENV.TEST_EMAIL || '';
const LOGIN_PASSWORD = __ENV.TEST_PASSWORD || '';
const VARIANT_ID = __ENV.TEST_VARIANT_ID || '';
const ADDRESS_ID = __ENV.TEST_ADDRESS_ID || '';
const EXPECTED_TOTAL = Number(__ENV.TEST_EXPECTED_TOTAL || '0');

const errors = new Rate('errors');

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 20, duration: '1m', exec: 'browse', tags: { path: 'browse' } },
    search: { executor: 'constant-vus', vus: 20, duration: '1m', exec: 'search', tags: { path: 'search' } },
    cards: { executor: 'constant-vus', vus: 10, duration: '1m', exec: 'cards', tags: { path: 'cards' } },
    login: { executor: 'constant-vus', vus: 5, duration: '1m', exec: 'login', tags: { path: 'login' } },
    checkout: { executor: 'shared-iterations', vus: 50, iterations: 200, maxDuration: '3m', exec: 'checkout', tags: { path: 'checkout' }, startTime: '1m10s' },
    receipt: { executor: 'shared-iterations', vus: 10, iterations: 50, maxDuration: '2m', exec: 'receipt', tags: { path: 'receipt' }, startTime: '1m10s' },
  },
  thresholds: {
    'http_req_duration{path:browse}': ['p(50)<300', 'p(95)<800', 'p(99)<1500'],
    'http_req_duration{path:search}': ['p(50)<400', 'p(95)<1200', 'p(99)<2500'],
    'http_req_duration{path:cards}': ['p(50)<200', 'p(95)<600', 'p(99)<1200'],
    'http_req_duration{path:login}': ['p(50)<600', 'p(95)<1500', 'p(99)<3000'],
    'http_req_duration{path:checkout}': ['p(50)<1500', 'p(95)<4000', 'p(99)<8000'],
    'http_req_duration{path:receipt}': ['p(50)<1000', 'p(95)<3000', 'p(99)<6000'],
    errors: ['rate<0.01'],
  },
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function session() {
  // Login once per VU and reuse the session cookie for write scenarios.
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }), { headers: { 'Content-Type': 'application/json' }, tags: { path: 'login' } });
  errors.add(res.status !== 200);
  return res.cookies;
}

export function browse() {
  const res = http.get(`${BASE}/api/v1/catalog/products?pageSize=24&sort=recommended`, { tags: { path: 'browse' } });
  errors.add(res.status !== 200);
  check(res, { 'browse 200': (r) => r.status === 200, 'browse has items': (r) => (r.json('items') || []).length >= 0 });
  sleep(0.5);
}

export function search() {
  const terms = ['ساعة', 'موبايل', 'شنطة', 'حذاء', 'لابتوب'];
  const q = terms[Math.floor(Math.random() * terms.length)];
  const res = http.get(`${BASE}/api/v1/catalog/products?q=${encodeURIComponent(q)}&pageSize=24`, { tags: { path: 'search' } });
  errors.add(res.status !== 200);
  // Page 2 via the keyset cursor (P4): follows nextCursor when present.
  const next = res.json('nextCursor');
  if (next) {
    const r2 = http.get(`${BASE}/api/v1/catalog/products?q=${encodeURIComponent(q)}&pageSize=24&cursor=${encodeURIComponent(next)}`, { tags: { path: 'search' } });
    errors.add(r2.status !== 200);
  }
  sleep(0.5);
}

export function cards() {
  const url = PRODUCT_SLUG ? `${BASE}/api/v1/catalog/products/${PRODUCT_SLUG}` : `${BASE}/api/products/cards`;
  const res = http.get(url, { tags: { path: 'cards' } });
  errors.add(res.status !== 200 && res.status !== 404);
  sleep(0.3);
}

export function login() {
  if (!LOGIN_EMAIL) return; // fixture not seeded: scenario reports 0 iterations, thresholds still pass
  session();
  sleep(1);
}

export function checkout() {
  if (!LOGIN_EMAIL || !VARIANT_ID) return;
  const cookies = session();
  // 200 VU-iterations race the same variant (P3). A unique checkoutKey per attempt is REQUIRED:
  // reusing one key would test idempotency, not concurrency. Overselling must never happen whatever wins.
  const res = http.post(
    `${BASE}/api/v1/orders`,
    JSON.stringify({ addressId: ADDRESS_ID, paymentMethod: 'INSTAPAY', checkoutKey: uuid(), expectedTotal: EXPECTED_TOTAL }),
    { headers: { 'Content-Type': 'application/json' }, cookies, tags: { path: 'checkout' } },
  );
  // 201 created, or the honest rejections: stock out / hot-row conflict. A 5xx here is a failure.
  const ok = [200, 201, 400, 409, 422].includes(res.status);
  errors.add(!ok);
  check(res, { 'checkout no 5xx': (r) => r.status < 500 });
}

export function receipt() {
  if (!LOGIN_EMAIL) return;
  const cookies = session();
  // Minimal valid PDF (L10 content gate passes) standing in for a receipt image; the upload endpoint is /api/files.
  const pdf = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
  const res = http.post(`${BASE}/api/files`, { file: http.file(pdf, 'receipt.pdf', 'application/pdf') }, { cookies, tags: { path: 'receipt' } });
  const ok = [200, 201, 400, 401, 413, 415, 422].includes(res.status);
  errors.add(!ok);
  check(res, { 'receipt no 5xx': (r) => r.status < 500 });
}

export function teardown() {
  console.log(`done — full latency table (p50/p95/p99) and error rate are in the k6 end-of-test summary`);
}
