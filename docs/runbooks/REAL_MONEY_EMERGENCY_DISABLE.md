# Real-Money Emergency Disable

## Engage (one person, immediate)
`/admin/finance-control` → «إيقاف طوارئ: كل الحركات المالية الجديدة» → reason → إيقاف.
Requires `finance.controls` and a 2FA re-check within 10 minutes. Audited: `killswitch.global_engaged`.

Effect (server-side, every money path calls `assertNotPaused` → `assertFinancialSafety`): payment confirmation, seller release, deal release, refunds, withdrawal approval/reservation, payouts, adjustments are all refused with "مفيش أي حركة اتعملت". **Not affected**: login, browsing, orders history, deals history, messaging, support, disputes (evidence/replies), investigation screens.

Finer switches remain (`killswitch.withdrawals`, `.payouts`, `.refunds`, …) for partial pauses.

Also: `payments.realMoneyEnabled` can be set back to false from settings (step-up) — it can never be turned on by this runbook.

## Release (two people — Maker/Checker)
1. Person A: «إعادة التشغيل» with reason → state RELEASE_REQUESTED (`killswitch.global_release_requested`).
2. Person B (different user, `finance.controls`, fresh 2FA) → «إعادة التشغيل» → RELEASED (`killswitch.global_released`, records both people).
The same person can never complete both steps. Engaging again cancels a pending release request.

Before releasing: latest ledger health not CRITICAL, cause fixed, incident note written.
