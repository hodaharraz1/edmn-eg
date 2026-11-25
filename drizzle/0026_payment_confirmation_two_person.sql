ALTER TABLE "payments" ADD COLUMN "review_started_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_review_started_by_users_id_fk" FOREIGN KEY ("review_started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: payments confirmed before this rule have no recorded reviewer and must not block the migration
-- (staging/production already hold such rows). Every row inserted or updated from now on IS checked, and a
-- confirmed payment is never updated afterwards, so the rule binds every new confirmation.
ALTER TABLE "payments" ADD CONSTRAINT "payments_two_person_chk" CHECK ("payments"."confirmed_by" is null or ("payments"."review_started_by" is not null and "payments"."confirmed_by" <> "payments"."review_started_by")) NOT VALID;--> statement-breakpoint
-- Payment confirmations are two-person (owner instruction 2026-11-25): the reviewer who started the
-- review is the Maker; a DIFFERENT staff member confirms (Checker). Applies to NEW approvals only.
CREATE OR REPLACE FUNCTION edmn_movement_requires_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW.action IN ('PAYMENT_CONFIRMATION', 'DEAL_PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'REFUND_REVOCATION', 'WITHDRAWAL_RELEASE_RESERVATION',
                    'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'MANUAL_ADJUSTMENT', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT')
     AND NEW.status IN ('APPROVED', 'CONSUMED')
     AND (NOT NEW.dual_control OR NEW.requested_by IS NULL OR NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
    RAISE EXCEPTION 'financial movement % requires a maker and a different checker', NEW.action USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
