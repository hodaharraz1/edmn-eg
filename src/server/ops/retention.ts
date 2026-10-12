/**
 * DATA RETENTION CLASSIFICATION (Batch 2). Periods marked LEGAL_POLICY_OWNER_INPUT_REQUIRED are NOT decided by
 * engineering: no job deletes or anonymizes those records. Only operational telemetry has an implemented,
 * PROPOSED retention (ops.prune_telemetry, rate_limits.prune, outbox secret redaction).
 *
 * Hard rules (code-enforced elsewhere): closing an account never deletes orders, deals, obligations, journal
 * entries, approvals, audit logs, disputes or identity decisions; financial/audit tables are append-only by trigger;
 * logs never contain national IDs, payout details, codes or passwords (logger redaction).
 */
export type RetentionDecision = 'IMPLEMENTED' | 'PROPOSED' | 'LEGAL_POLICY_OWNER_INPUT_REQUIRED';

export interface RetentionClass {
  code: string;
  data: string;
  period: string;
  decision: RetentionDecision;
  deletionAllowed: 'NEVER_AUTOMATIC' | 'AUTOMATIC' | 'AFTER_OWNER_DECISION';
}

export const RETENTION_POLICY: RetentionClass[] = [
  { code: 'FINANCIAL_LEDGER', data: 'journal_entries, journal_lines, financial_approvals, withdrawal_allocations, financial_closes', period: 'Statutory accounting period (Egyptian tax/commercial law) — to confirm', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'NEVER_AUTOMATIC' },
  { code: 'AUDIT_TRAIL', data: 'audit_logs, status_history, ledger_health_checks', period: 'At least as long as the financial records they explain — to confirm', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'NEVER_AUTOMATIC' },
  { code: 'COMMERCE_RECORDS', data: 'orders, seller_orders, external_deals, payments, refunds, disputes, returns (+ pricing snapshots)', period: 'Consumer-protection / commercial limitation periods — to confirm', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'NEVER_AUTOMATIC' },
  { code: 'IDENTITY_KYC', data: 'user_identity_verifications (encrypted national ID), IDENTITY_DOCUMENT / SELLER_DOCUMENT files', period: 'KYC / AML retention after relationship ends — to confirm with counsel', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'AFTER_OWNER_DECISION' },
  { code: 'PAYOUT_DESTINATIONS', data: 'receiving_destinations, seller_payout_methods (encrypted, versioned)', period: 'As long as any payout referencing them is retained — to confirm', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'NEVER_AUTOMATIC' },
  { code: 'EVIDENCE_FILES', data: 'payment proofs, waybills, dispute/deal/return evidence, withdrawal/refund proofs', period: 'Dispute window + limitation period — to confirm', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'AFTER_OWNER_DECISION' },
  { code: 'MESSAGES', data: 'conversations, conversation_messages, attachments, support tickets', period: 'To be set by the privacy policy', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED', deletionAllowed: 'AFTER_OWNER_DECISION' },
  { code: 'OUTBOX_SECRETS', data: 'outbound_messages bodies carrying codes / reset or invitation links', period: 'Redacted after hand-off to a real provider, at dead-letter, and after 1 hour at the latest', decision: 'IMPLEMENTED', deletionAllowed: 'AUTOMATIC' },
  { code: 'OUTBOX_METADATA', data: 'outbound_messages (recipient, status, provider id) without secrets', period: 'PROPOSED 180 days (not yet pruned)', decision: 'PROPOSED', deletionAllowed: 'AFTER_OWNER_DECISION' },
  { code: 'JOB_TELEMETRY', data: 'job_runs', period: '14 days', decision: 'IMPLEMENTED', deletionAllowed: 'AUTOMATIC' },
  { code: 'ERROR_EVENTS', data: 'error_events (already redacted)', period: '90 days after last occurrence', decision: 'IMPLEMENTED', deletionAllowed: 'AUTOMATIC' },
  { code: 'RATE_LIMIT_COUNTERS', data: 'rate_limits', period: '1 day', decision: 'IMPLEMENTED', deletionAllowed: 'AUTOMATIC' },
  { code: 'SESSIONS', data: 'sessions (hashed tokens), auth_tokens (hashed)', period: 'Expiry + PROPOSED 30 days', decision: 'PROPOSED', deletionAllowed: 'AFTER_OWNER_DECISION' },
  { code: 'APPLICATION_LOGS', data: 'platform logs (Vercel)', period: 'Provider retention (plan-dependent); logs are redacted at source', decision: 'PROPOSED', deletionAllowed: 'AUTOMATIC' },
];
