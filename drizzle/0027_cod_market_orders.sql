ALTER TABLE "orders" DROP CONSTRAINT "orders_totals_chk";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_status_chk";--> statement-breakpoint
ALTER TABLE "financial_approvals" DROP CONSTRAINT "financial_approvals_action_chk";--> statement-breakpoint
ALTER TABLE "financial_movement_requests" DROP CONSTRAINT "financial_movement_requests_kind_chk";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_chk" CHECK ("orders"."grand_total" = "orders"."merchandise_total" + "orders"."shipping_total" + "orders"."buyer_fee_total" + "orders"."cod_fee" - "orders"."discount_total" and "orders"."grand_total" >= 0 and "orders"."buyer_fee_total" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_chk" CHECK ("payments"."status" in ('AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COD_PENDING', 'COD_COLLECTED'));--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'REFUND_REVOCATION', 'COD_REMITTANCE'));--> statement-breakpoint
ALTER TABLE "financial_movement_requests" ADD CONSTRAINT "financial_movement_requests_kind_chk" CHECK ("financial_movement_requests"."kind" in ('SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN', 'COD_REMITTANCE'));--> statement-breakpoint
-- COD remittance joins the universal two-person rule (owner instruction 2026-11-25, PKG-COD-01):
-- a Maker opens the COD_REMITTANCE request; a DIFFERENT staff member records it.
CREATE OR REPLACE FUNCTION edmn_movement_requires_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW.action IN ('PAYMENT_CONFIRMATION', 'DEAL_PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'REFUND_REVOCATION', 'WITHDRAWAL_RELEASE_RESERVATION',
                    'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'MANUAL_ADJUSTMENT', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'COD_REMITTANCE')
     AND NEW.status IN ('APPROVED', 'CONSUMED')
     AND (NOT NEW.dual_control OR NEW.requested_by IS NULL OR NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
    RAISE EXCEPTION 'financial movement % requires a maker and a different checker', NEW.action USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
