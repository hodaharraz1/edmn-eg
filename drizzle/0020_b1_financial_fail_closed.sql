-- B1 FINANCIAL FAIL-CLOSED (P0 #2, #3). Additive only: no data is changed or removed.
-- P0 #3: an explicit state for a refund payout whose external outcome is unknown.
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_status_chk";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_chk" CHECK ("refunds"."status" in ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED', 'PENDING', 'PAID', 'TRANSFER_UNCERTAIN'));--> statement-breakpoint
-- P0 #2: the money gate now reads kill switches strictly (a MISSING row = PAUSED). Record the current effective
-- state explicitly for every switch that has no row yet ("running" = false, the previous implicit default).
-- An existing row — engaged, released or malformed — is never overwritten (a malformed one stays PAUSED).
INSERT INTO "system_settings" ("key", "value")
SELECT k, 'false'::jsonb FROM unnest(ARRAY[
  'killswitch.global',
  'killswitch.paymentConfirmation',
  'killswitch.sellerRelease',
  'killswitch.refunds',
  'killswitch.withdrawals',
  'killswitch.payouts',
  'killswitch.dealRelease',
  'killswitch.adjustments'
]) AS k
ON CONFLICT ("key") DO NOTHING;
