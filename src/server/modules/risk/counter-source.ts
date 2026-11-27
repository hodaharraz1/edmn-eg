import type { CounterScan } from '@/server/auth/rate-limit';

/** Thresholds the /admin/risk page uses on the attempt counters (unchanged from before PKG-PERF-01). */
export const LOGIN_FLAG_MIN = 10;
export const TOTP_FLAG_MIN = 8;

/** The sentence under the risk page header that says where the attempt numbers come from and what they cover. */
export function counterSourceNote(scan: Pick<CounterScan, 'source' | 'shared' | 'degraded'>): string {
  if (scan.source === 'memory') {
    return 'أرقام محاولات الدخول وأكواد 2FA هنا لسيرفر التطبيق الحالي فقط (لا يوجد REDIS_URL). محاولات سيرفرات أخرى وما قبل آخر إعادة تشغيل غير ظاهرة.';
  }
  if (scan.degraded) {
    return 'تعذّرت قراءة Redis الآن، فأرقام محاولات الدخول وأكواد 2FA هنا لسيرفر التطبيق الحالي فقط وقد تكون ناقصة.';
  }
  return 'أرقام محاولات الدخول وأكواد 2FA هنا من عدّادات Redis المشتركة بين كل السيرفرات، للنافذة الزمنية الحالية فقط.';
}
