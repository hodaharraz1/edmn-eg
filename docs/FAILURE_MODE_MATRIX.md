# Failure Mode Matrix

| Failure | Detection | System behaviour (fail closed) | Recovery |
|---|---|---|---|
| Seller never uploads delivery evidence | job `flagMissingDeliveryEvidence` (15 min) | `SELLER_EVIDENCE_MISSING` exception + HIGH flag; no buyer timer, no entitlement | Ops review: KEEP_OPEN / ESTABLISH (needs event + evidence) / shipment exception path |
| Evidence late | at submission | `SELLER_EVIDENCE_LATE` exception | Ops review with reason |
| No carrier/Ops delivery event | job `flagMissingDeliveryEvents` (1 h) | `DELIVERY_EVENT_MISSING` exception | Ops checks carrier, records event |
| Carrier failure/refusal/loss/damage | seller or Ops records exception | delivery path held; never "delivered" | RESHIP or DELIVERY_FAILED + refund request |
| Buyer objection at the deadline | row lock + in-lock `now()` check | dispute wins → `TIMEOUT_BLOCKED`; otherwise entitlement then dispute still blocks release | dispute decision |
| Worker down for days | timeout job on resume | entitlement at real processing time (not backdated); deadlines unchanged | none needed |
| Notification send fails | outbound status FAILED (control center) | business state unaffected; deadlines unchanged | resend; deadlines are never restarted |
| Duplicate click / retry | idempotency keys, row locks, approval keys | one effect | — |
| Approval stale / revoked / reused / mismatched | app + DB trigger | refused; nothing posted | re-open page, approve again |
| Ledger projection drift | `sellerLedgerDrift`, invariants | release & withdrawal approval refused | finance investigation; correction by approved adjustment |
| Negative seller balance (refund after release) | guard + payout check | payouts blocked | seller settles debt |
| Kill switch setting unreadable | `assertNotPaused` catch | treated as paused | fix setting |
| Missing fee config | `requireFeeConfig` | checkout blocked with message | Admin sets fee config |
| Provider webhook forged/stale/duplicate | HMAC, ±5 min, unique id | 401/400/duplicate ack; nothing moves | — |
| Provider not connected | no secret | 503 | — |
| Statement mismatch | confirmMatch | MISMATCH + HIGH flag | investigate |
| Account closure race | advisory lock `account:<id>` | one outcome | — |
| Real-money enable attempt while blockers exist | `goLiveGate` | refused | clear blockers + owner decision |
| DB restore needed | — | see BACKUP_RESTORE_RUNBOOK (drill BLOCKED) | PITR branch |
