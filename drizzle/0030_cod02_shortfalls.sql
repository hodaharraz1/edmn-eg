-- PKG-COD-02 (owner instruction phonemsg-01M89JZYZQBK3W5EQ1DJHETV2A): courier-statement COD remittance with shortfall tracking.
-- New table cod_remittance_shortfalls; widened CHECKs are supersets (existing rows remain valid).

CREATE TABLE "cod_remittance_shortfalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"expected_amount" bigint NOT NULL,
	"actual_amount" bigint NOT NULL,
	"shortfall_amount" bigint NOT NULL,
	"statement_ref" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolution_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cod_shortfall_status_chk" CHECK ("cod_remittance_shortfalls"."status" in ('OPEN', 'RESOLVED')),
	CONSTRAINT "cod_shortfall_resolution_chk" CHECK ("cod_remittance_shortfalls"."resolution" in ('RECOVERED', 'WRITTEN_OFF')),
	CONSTRAINT "cod_shortfall_amounts_chk" CHECK ("cod_remittance_shortfalls"."expected_amount" > 0 and "cod_remittance_shortfalls"."actual_amount" >= 0 and "cod_remittance_shortfalls"."shortfall_amount" > 0 and "cod_remittance_shortfalls"."actual_amount" + "cod_remittance_shortfalls"."shortfall_amount" = "cod_remittance_shortfalls"."expected_amount"),
	CONSTRAINT "cod_shortfall_resolved_chk" CHECK (("cod_remittance_shortfalls"."status" = 'RESOLVED') = ("cod_remittance_shortfalls"."resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "financial_approvals" DROP CONSTRAINT "financial_approvals_action_chk";--> statement-breakpoint
ALTER TABLE "financial_movement_requests" DROP CONSTRAINT "financial_movement_requests_kind_chk";--> statement-breakpoint
ALTER TABLE "cod_remittance_shortfalls" ADD CONSTRAINT "cod_remittance_shortfalls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittance_shortfalls" ADD CONSTRAINT "cod_remittance_shortfalls_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cod_shortfall_payment_uq" ON "cod_remittance_shortfalls" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "cod_shortfall_status_idx" ON "cod_remittance_shortfalls" USING btree ("status") WHERE "cod_remittance_shortfalls"."status" = 'OPEN';--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'REFUND_REVOCATION', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION'));--> statement-breakpoint
ALTER TABLE "financial_movement_requests" ADD CONSTRAINT "financial_movement_requests_kind_chk" CHECK ("financial_movement_requests"."kind" in ('SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION'));
--> statement-breakpoint
-- Settling a COD shortfall moves money (cash recovered or written off to expense): it joins the DB-level
-- two-person rule like COD_REMITTANCE (exact superset of the 0027 definition).
CREATE OR REPLACE FUNCTION edmn_movement_requires_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW.action IN ('PAYMENT_CONFIRMATION', 'DEAL_PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'REFUND_REVOCATION', 'WITHDRAWAL_RELEASE_RESERVATION',
                    'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'MANUAL_ADJUSTMENT', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION')
     AND NEW.status IN ('APPROVED', 'CONSUMED')
     AND (NOT NEW.dual_control OR NEW.requested_by IS NULL OR NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
    RAISE EXCEPTION 'financial movement % requires a maker and a different checker', NEW.action USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
