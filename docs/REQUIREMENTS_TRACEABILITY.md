# Requirements Traceability — Hardening Test Matrix (1–108)

Files: `I:` = `tests/integration/`, `U:` = `tests/unit/`, `E:` = `tests/e2e/`. "hd" = hardening-delivery, "hm" = hardening-money,
"hx" = hardening-matrix. Status reflects the local run on the final commit (see the final report for staging).

| # | Requirement | Test(s) |
|---|---|---|
| 1 | unpaid cancellation | I:hx «#1 unpaid cancellation…» |
| 2 | paid cancellation | I:hm «paid cancellation → REQUESTED refund…» |
| 3 | seller cancellation | I:fulfilment-finance EDGE 8; I:hm paid cancellation (seller actor) |
| 4 | out-of-stock after checkout attempt | I:hx «#4 out of stock…»; I:checkout-payments EDGE 1 |
| 5 | expired unpaid payment | I:checkout-payments «unpaid orders expire…» |
| 6 | submitted proof survives expiry | I:hx «#6 …survives the expiry job» |
| 7 | duplicate payment confirmation | I:checkout-payments EDGE 3/4; I:security-gate SEC-PAY-5 |
| 8 | invalid state transition | U:state-machines «block invalid transitions»; U:hardening-machines |
| 9 | two buyers, last item | I:checkout-payments EDGE 1 |
| 10 | reservation expiry | I:checkout-payments «unpaid orders expire and release reserved stock» |
| 11 | cancellation releases stock | I:hx «#11 paid cancellation restocks»; I:hx #1 |
| 12 | confirmed order consumes reservation | I:checkout-payments «creates one parent order…»; invariant INVALID_RESERVATION (I:hm) |
| 13 | two sellers one parent | I:checkout-payments «one sub-order per seller» |
| 14 | A ships, B delays | I:hx «#14/#17…» |
| 15 | B cancellation doesn't affect A | I:fulfilment-finance EDGE 8 |
| 16 | isolated seller communication | I:messaging 7-8 |
| 17 | isolated balances | I:hx «#14/#17…» |
| 18 | isolated returns | I:postpurchase EDGE 9; I:fulfilment-finance EDGE 15 (seller cannot act on other seller's order) |
| 19 | full refund before receipt | I:postpurchase «open dispute holds…; full-refund decision reverses»; I:hm paid cancellation |
| 20 | partial refund | I:hm «approved partial refund after release…» |
| 21 | item-level refund | I:postpurchase EDGE 9; I:hm «one of three units…» |
| 22 | quantity-level refund | I:hm «one of three units…» |
| 23 | duplicate refund blocked | I:hx «#23…» |
| 24 | refund > refundable blocked | I:hm «…over-refund refused» |
| 25 | commission reversal correct | I:hm «one of three units…» (fee components = snapshot exactly) |
| 26 | seller liability correct | I:hm «one of three units…», «approved partial refund…» |
| 27 | failed delivery | I:hx DELIVERY_ATTEMPT_FAILED → RESHIP |
| 28 | refused delivery | I:hx BUYER_REFUSED |
| 29 | return to seller | I:hx RETURN_TO_SELLER |
| 30 | lost shipment | I:hx LOST_IN_TRANSIT |
| 31 | damaged shipment | I:hx DAMAGED_IN_TRANSIT |
| 32 | buyer never confirms | I:hd «timely evidence + event → … TIMEOUT_ENTITLEMENT» |
| 33 | wrong buyer blocked | I:fulfilment-finance «…other customers cannot either» |
| 34 | seller cannot confirm for buyer | I:hd «only the buyer can confirm receipt»; I:fulfilment-finance |
| 35 | double-click release once | I:hm «concurrent double release…» |
| 36 | dispute vs release race | I:hx «#36…» |
| 37 | withdrawal > available | I:fulfilment-finance «cannot withdraw more than available» |
| 38 | simultaneous withdrawal race | I:fulfilment-finance EDGE 12; I:security-gate SEC-WD-1 |
| 39 | duplicate approval blocked | I:fulfilment-finance EDGE 11 (concurrent approvals reserve once) |
| 40 | duplicate payout blocked | I:hx «#40…» |
| 41 | maker/checker | I:fulfilment-finance EDGE 17; I:hm «threshold 0…»; I:security-gate SEC-WD-2/4 |
| 42 | payout destination snapshot | I:hm «request → no journal…» (snapshot frozen, DB-immutable) |
| 43–47 | payment / release / refund / withdrawal / reversal balanced | I:hm invariants test; I:hx «#47…»; I:security-gate SEC-LG-* |
| 48 | duplicate event no duplicate journal | I:checkout-payments EDGE 3/4; I:hm double release; invariant DUPLICATE_BUSINESS_EVENT |
| 49 | invitation claim security | I:deal-invitation-returns (binding, anti-enumeration, expiry) |
| 50 | counter-offer | I:deal-invitation-returns «request change → new version…» |
| 51 | terms snapshot | I:deal-invitation-returns «agreed terms … immutable» |
| 52 | OTP expiry | I:delivery-otp 2 |
| 53 | OTP attempt limit | I:delivery-otp 6 |
| 54 | OTP double-submit | I:delivery-otp 13 |
| 55 | «لم أستلم» | I:delivery-otp 22 |
| 56 | product problem | I:delivery-otp 21; E:protected-deal second deal |
| 57 | dispute hold | I:delivery-otp 21/22; I:postpurchase |
| 58 | refund/reversal (deal) | I:postpurchase full flow; deal refund via approveDealRefundTx |
| 59 | buyer order IDOR | I:privacy-idor; I:postpurchase EDGE 16; E:security |
| 60 | seller order IDOR | I:fulfilment-finance EDGE 15; E:security |
| 61 | payment proof IDOR | I:privacy-idor |
| 62 | waybill IDOR | I:privacy-idor |
| 63 | KYC IDOR | I:privacy-idor |
| 64 | message attachment IDOR | I:messaging 21 |
| 65 | withdrawal IDOR | I:security-gate SEC-WD-7; I:fulfilment-finance «payout details revealed only…» |
| 66 | protected deal IDOR | I:deal-invitation-returns «a stranger cannot act on a deal» |
| 67 | stored XSS | I:messaging 25-26; E:messaging |
| 68 | malicious upload | I:fulfilment-finance EDGE 19; I:messaging 28-29 |
| 69 | login rate limit | I:security-gate SEC-AU-2 |
| 70 | OTP rate limit | I:delivery-otp 5 |
| 71 | Admin RBAC | U:text-crypto-auth; I:sellers-catalog «low-privilege admins…»; I:fulfilment-finance EDGE 17 |
| 72 | Seller RBAC | I:pre-acceptance-audit «store members without orders.manage…»; I:messaging 22-23 |
| 73 | privilege escalation | I:security-gate SEC-AZ-1, SEC-WD-7; I:hm «non-Admin can never grant…» |
| 74 | buyer deactivation with history | I:hx «#74/#77…» |
| 75 | seller suspension with active order | I:checkout-payments EDGE 7 |
| 76 | seller suspension with balance | I:security-gate SEC-WD-5 |
| 77 | closure preserves ledger | I:hx «#74/#77…» |
| 78 | exact match | I:hx «#78/#81…» |
| 79 | ambiguous match | I:hx «#79/#80…» (suggestion only) |
| 80 | mismatch | I:hx «#79/#80…» |
| 81 | manual match audit | I:hx «#78/#81…» |
| 82 | ledger imbalance alert | I:hx «#82…»; I:fulfilment-finance «unbalanced entry rejected» |
| 83 | event generated once | I:hm «notification dedupe» |
| 84 | retry dedup | I:hm «notification dedupe» |
| 85 | correct recipient | I:messaging 32 |
| 86 | no sensitive payload | I:messaging 32; I:delivery-otp 14; I:pre-acceptance-audit OTP redaction |
| 87 | cancel before/after SHIPPED, every role | I:hm «after SHIPPED nobody can cancel», «paid cancellation…»; U:hardening-machines |
| 88 | ship vs cancel race | I:hm «cancel vs ship race» |
| 89 | closure blocked for balances/obligations | I:hm «account closure is blocked…»; I:hx «#89…» |
| 90 | closure vs order/withdrawal race | I:hx «#90…» (account advisory lock) |
| 91 | absent/stale/revoked/wrong-actor/mismatched approval | I:hm approvals block (absent, mismatched, amount, revoked, reused, non-Admin, stale) |
| 92 | receipt & timeout create zero release journals | I:hd «buyer confirmation is BUYER_CONFIRMED…», «…TIMEOUT_ENTITLEMENT with NO money movement» |
| 93 | distinct seller 24h / buyer 24h timestamps | I:hd «a carrier event without seller evidence…», «LATE evidence…», «timely evidence + event…» |
| 94 | seller timeout/carrier/message/GPS/waybill cannot establish acceptance | I:hd clarification block; I:messaging 10, 18-19; I:delivery-otp 16-19 |
| 95 | timeout entitlement once, pending, distinguishable | I:hd «timely evidence + event…» |
| 96 | missing/late evidence fail closed | I:hd «missed 24h…», «LATE evidence…» |
| 97 | objection vs timeout vs release race, exact deadline, delayed worker | I:hd «exact-deadline race», «delayed worker»; I:hx #36 |
| 98 | release idempotent, balanced, permissioned, blocked by holds/kill switches | I:hm double release, kill switch; I:hd held order; I:hm non-Admin |
| 99 | COMPLETED guards; mixed parent states | I:hx «#99…»; I:hm deriveParentStatus |
| 100 | fee split exact, shipping payer buyer | I:hm fee block |
| 101 | snapshots never rewritten; missing config blocks | I:hm «prospective only», «missing fee configuration…»; I:fulfilment-finance EDGE 13 |
| 102 | partial refund components | I:hm «one of three units…» |
| 103 | deal timeout cannot bypass OTP/dispute | I:delivery-otp «confirmation is impossible before a verified handover», 21/22 |
| 104 | withdrawal request moves nothing; concurrent approvals cannot overspend | I:hm «request → no journal…»; I:fulfilment-finance EDGE 12 |
| 105 | provider callback evidence only | I:hm «provider callback…» |
| 106 | messaging regressions, A-100016 read-only baseline, policy versions | I:messaging (41); staging read-only comparison (final report); I:sellers-catalog agreement version; E:storefront legal draft |
| 107 | release creates no payout/withdrawal | I:hx «#107…» |
| 108 | refund after completion via compensating entries | I:hx «#108…»; I:hm «approved partial refund after release…» |

Clarification checks: SELLER STATEMENT ALONE (I:hd clarification block 1), SELLER 24H FAILURE (I:hd block 2),
WITHDRAWAL REQUEST NO MOVEMENT (I:hm), PROTECTIVE HOLD WITHOUT APPROVAL (I:hd protective hold block).
