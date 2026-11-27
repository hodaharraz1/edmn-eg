#!/usr/bin/env bash
# PKG-E2E-02: smoke مختصر على staging بأمر واحد — targeted فقط حسب docs/TESTING_POLICY.md
# (ممنوع السويت الكامل على staging إلا لمرشح إصدار/بوابة قبول). يغطي الشاشات الأساسية للموقع ولوحة الإدارة.
# التشغيل:  STAGING_URL=https://staging.example.com ./scripts/staging-smoke.sh
set -euo pipefail
: "${STAGING_URL:?set STAGING_URL to the staging base URL}"
SPECS=(
  tests/e2e/homepage.spec.ts          # الرئيسية
  tests/e2e/storefront.spec.ts        # المتجر والكتالوج
  tests/e2e/marketplace-flow.spec.ts  # رحلة الشراء الأساسية
  tests/e2e/protected-deal.spec.ts    # الصفقة المحمية
  tests/e2e/cod-remittance.spec.ts    # COD ولوحة الإدارة المالية
)
echo "targeted staging smoke against $STAGING_URL (${#SPECS[@]} specs)"
E2E_BASE_URL="$STAGING_URL" npx playwright test "${SPECS[@]}" --project=chromium "$@"
