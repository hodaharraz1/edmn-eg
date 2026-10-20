# Data Preservation Register

Rule for every row: **no deletion, no destructive transformation, original IDs and timestamps
retained and traceable**. "Location" for legacy data is `UNKNOWN` until the schema is provided;
System B currently holds **no production data** (development seed only), so preservation obligations
apply almost entirely to legacy data and to data that will exist once B launches.

Classes: CRITICAL_FINANCIAL · CRITICAL_IDENTITY · CRITICAL_LEGAL · CRITICAL_AUDIT · OPERATIONAL ·
CONFIGURATION · NONCRITICAL.

| # | Data family | Legacy location | B location | Class | Preservation requirement |
|---|---|---|---|---|---|
| 1 | User accounts (IDs, status, created_at) | UNKNOWN | users | CRITICAL_IDENTITY | Keep legacy IDs forever; map, never renumber |
| 2 | Customer profiles (names) | UNKNOWN | users.full_name | CRITICAL_IDENTITY | Preserve history of name changes if legacy keeps it |
| 3 | Phone numbers | UNKNOWN | users.phone (E.164, unique) | CRITICAL_IDENTITY | Store original string + normalized form; detect duplicates, never auto-merge |
| 4 | Email addresses | UNKNOWN | users.email (unique) | CRITICAL_IDENTITY | Same as phones |
| 5 | Password / auth identities | UNKNOWN (algorithm unknown) | users.password_hash (scrypt) | CRITICAL_IDENTITY | Keep legacy hash + algorithm tag; verify with legacy algorithm, rehash on next login; never reset en masse |
| 6 | KYC records (status, decision, reviewer) | UNKNOWN | (seller KYB only) | CRITICAL_LEGAL | Preserve full history including rejections |
| 7 | KYC documents (IDs, selfies, etc.) | UNKNOWN (files) | files (SELLER_DOCUMENT) | CRITICAL_LEGAL | Never move/delete originals; checksum; private access only |
| 8 | Wallets | UNKNOWN | — (none) | CRITICAL_FINANCIAL | Preserve per-user balances exactly; snapshot with checksum before any change |
| 9 | Balances | UNKNOWN | ledger_accounts (sellers/platform) | CRITICAL_FINANCIAL | Balance must equal Σ movements; document any drift before integration |
| 10 | Wallet movements | UNKNOWN | — | CRITICAL_FINANCIAL | Immutable history, original refs |
| 11 | Top-up requests (+ proofs) | UNKNOWN | — (payments are order/deal only) | CRITICAL_FINANCIAL | Preserve all statuses incl. rejected; proofs kept |
| 12 | Payment requests | UNKNOWN | payments, payment_submissions | CRITICAL_FINANCIAL | Same |
| 13 | Payment methods | UNKNOWN (meaning unclear) | payment_methods / destinations / seller_payout_methods | CONFIGURATION / CRITICAL_FINANCIAL if user payout accounts | Clarify meaning; encrypted if account numbers |
| 14 | Transactions | UNKNOWN | journal / payments | CRITICAL_FINANCIAL | Never rewrite; import as source-referenced history |
| 15 | Guarantees | UNKNOWN | (external_deals is not proven equivalent) | CRITICAL_FINANCIAL + CRITICAL_LEGAL | Preserve full lifecycle, amounts, fees, parties |
| 16 | Guarantee parties | UNKNOWN | external_deals buyer/seller | CRITICAL_IDENTITY | Keep links to legacy user IDs |
| 17 | Guarantee statuses / history | UNKNOWN | status_history (B) | CRITICAL_AUDIT | Preserve legacy status values verbatim (no remapping of history) |
| 18 | Guarantee evidence / documents | UNKNOWN | files (DEAL_EVIDENCE) | CRITICAL_LEGAL | Keep originals |
| 19 | Withdrawals (customer) | UNKNOWN | — | CRITICAL_FINANCIAL | Preserve pending + completed + rejected; never merge with seller withdrawals |
| 20 | Historical withdrawals + proofs/references | UNKNOWN | withdrawal_requests (sellers only) | CRITICAL_FINANCIAL | Keep bank references, approver, payer |
| 21 | Tickets | UNKNOWN | support_tickets | OPERATIONAL (H) | Preserve |
| 22 | Ticket messages + attachments | UNKNOWN | support_messages, files | OPERATIONAL (H) | Preserve |
| 23 | Notifications | UNKNOWN | notifications, outbound_messages | NONCRITICAL (OPERATIONAL if delivery proof needed) | Archive; not required in new UI |
| 24 | Admin accounts | UNKNOWN | users (is_staff) | CRITICAL_AUDIT | Preserve IDs (audit logs reference them) |
| 25 | Roles | UNKNOWN | roles | CONFIGURATION | Preserve definitions + history |
| 26 | Permissions | UNKNOWN | role_permissions | CONFIGURATION | Preserve |
| 27 | Activity logs | UNKNOWN | audit_logs | CRITICAL_AUDIT | Read-only archive; never edit; keep actor IDs |
| 28 | Audit logs | UNKNOWN | audit_logs, status_history | CRITICAL_AUDIT | Same |
| 29 | Fee settings (current + historical) | UNKNOWN | system_settings, commission_rules | CONFIGURATION (F) | Historical fees needed to explain past amounts |
| 30 | Configuration | UNKNOWN | system_settings | CONFIGURATION | Inventory names only (no secrets in reports) |
| 31 | Historical reports / statistics | UNKNOWN | reports (computed) | NONCRITICAL | Recompute from preserved data; export snapshots if used for filings |
| 32 | Uploaded files (all) | UNKNOWN | files + storage | CRITICAL_LEGAL | Full backup + checksum manifest before integration |
| 33 | Timestamps | UNKNOWN (TZ unknown) | timestamptz | CRITICAL_AUDIT | Preserve originals; record source time zone |
| 34 | References / IDs (legacy numbers shown to customers) | UNKNOWN | number sequences | CRITICAL_AUDIT | Keep legacy reference numbers searchable |
| 35 | Marketing site leads (Formspree / Airtable) | outside A and B | — | CRITICAL_IDENTITY (PII) / OPERATIONAL | Inventory owner, retention and consent; not part of DB migration |
| 36 | Mobile app device tokens (if push) | UNKNOWN | — | OPERATIONAL | Needed to keep push notifications working |
| 37 | Legal acceptances (which terms version a user accepted) | UNKNOWN | legal_acceptances | CRITICAL_LEGAL | Preserve per user/version/date |
