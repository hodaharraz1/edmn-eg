# Feature Preservation Matrix (Legacy features)

Legacy features are the **owner-reported list plus publicly claimed product features**; their
"current location" is UNKNOWN until the legacy code is inspected. **No feature is marked for
deletion.** Classes: MUST_PRESERVE · CAN_MODERNIZE · POTENTIAL_DEPRECATION_REQUIRES_OWNER_APPROVAL.

| Feature | Current location | Dependencies | Data | Users | Future location (proposed) | Preservation | Integration risk |
|---|---|---|---|---|---|---|---|
| User registration / login (app) | Legacy API + mobile app (UNKNOWN routes) | auth, SMS/OTP? | users, credentials | customers | Legacy, later unified identity | MUST_PRESERVE | P0 |
| User management (admin) | Legacy admin | users | users | admins | Unified ops center (Customers) | MUST_PRESERVE | P1 |
| KYC submission & review | Legacy | files, users | KYC records, documents | customers, admins | Legacy (Risk & Compliance) | MUST_PRESERVE | P0 |
| Financial guarantees (create, fund, deliver, confirm, release) | Legacy (core product) | wallet/payments, fees, notifications | guarantees, parties, statuses, evidence | customers, merchants, admins | Legacy; later shared escrow engine | MUST_PRESERVE | P0 |
| Guarantee disputes / support intervention | Legacy (UNKNOWN form) | tickets? | messages, evidence | customers, admins | Shared dispute center later | MUST_PRESERVE | P1 |
| Services/digital-work guarantees | Legacy (claimed) | guarantees | — | customers | Legacy | MUST_PRESERVE | P1 (B deals cover goods only) |
| Wallet & balances | Legacy | transactions | balances, movements | customers | Legacy (Finance → Wallets) | MUST_PRESERVE | P0 |
| Top-up requests + approval | Legacy | payment methods, files | requests, proofs | customers, finance | Legacy; shared verification engine later | MUST_PRESERVE | P0 |
| Customer withdrawals + approval | Legacy | wallet, payment methods | requests, references | customers, finance | Legacy (Finance → Customer withdrawals) | MUST_PRESERVE | P0 |
| Payment methods management | Legacy | — | config / user accounts | admins | UNDECIDED (semantics unclear) | MUST_PRESERVE | P1 |
| Transactions history | Legacy | wallet, guarantees | transactions | customers, finance | Legacy read-only history + viewer | MUST_PRESERVE | P0 |
| Fee settings (5% / 3% tiers claimed) | Legacy | guarantees | settings history | admins | Versioned product fee config | MUST_PRESERVE (CAN_MODERNIZE UI) | P1 |
| Tickets / support | Legacy | users | tickets, messages | customers, support | Unified support later | MUST_PRESERVE (CAN_MODERNIZE) | M |
| Notifications (likely push) | Legacy | device tokens, providers | notifications | customers | Shared notification service | MUST_PRESERVE (CAN_MODERNIZE) | P1 |
| Admins management | Legacy | roles | admins | super admins | Unified RBAC | MUST_PRESERVE (CAN_MODERNIZE) | P1 |
| Roles & permissions | Legacy | admins | roles | super admins | Namespaced unified RBAC | MUST_PRESERVE (CAN_MODERNIZE) | P1 |
| Activity logs | Legacy | all | logs | auditors | Read-only archive + unified viewer | MUST_PRESERVE | P1 |
| Statistics / charts | Legacy | all | computed | management | Unified dashboard | CAN_MODERNIZE | L |
| Mobile app API contracts | Legacy API | all of the above | — | mobile app | Unchanged (`BACKWARD_COMPATIBILITY_REQUIRED`) | MUST_PRESERVE | P0 |
| Marketing site lead capture (Formspree/Airtable) | marketing repo | third parties | leads (PII) | marketing | Unchanged; consent/retention review | MUST_PRESERVE | P2 |
| Any legacy feature not yet discovered | UNKNOWN | — | — | — | — | MUST_PRESERVE by default | UNKNOWN |

Nothing in this audit is classified `POTENTIAL_DEPRECATION_REQUIRES_OWNER_APPROVAL`, because no
legacy feature has been inspected; deprecation can only be proposed with evidence and owner approval.
