CREATE TABLE "deployment_environment" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"environment" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_environment_singleton_chk" CHECK ("deployment_environment"."id"),
	CONSTRAINT "deployment_environment_chk" CHECK ("deployment_environment"."environment" in ('DEVELOPMENT', 'TEST', 'STAGING', 'PRODUCTION'))
);
--> statement-breakpoint
ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "withdrawals_status_chk";--> statement-breakpoint
ALTER TABLE "financial_approvals" DROP CONSTRAINT "financial_approvals_action_chk";--> statement-breakpoint
ALTER TABLE "seller_payout_methods" ADD COLUMN "verified_fingerprint" text;--> statement-breakpoint
ALTER TABLE "seller_payout_methods" ADD COLUMN "verification_reason" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "approved_destination" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_reapproval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_uncertain_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_uncertain_by" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_failed_by" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_failure_reason" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_failure_evidence" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "returned_amount" bigint;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "returned_by" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "returned_reference" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "return_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_destination_changed_by_users_id_fk" FOREIGN KEY ("destination_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_destination_approved_by_users_id_fk" FOREIGN KEY ("destination_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_transfer_uncertain_by_users_id_fk" FOREIGN KEY ("transfer_uncertain_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_transfer_failed_by_users_id_fk" FOREIGN KEY ("transfer_failed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawals_status_chk" CHECK ("withdrawal_requests"."status" in ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED', 'TRANSFER_UNCERTAIN', 'FAILED_BEFORE_TRANSFER', 'RETURNED'));--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN'));--> statement-breakpoint
-- ═══════════ C8: a PRODUCTION database refuses demo / E2E / test fixtures (fail closed, DB level) ═══════════
CREATE OR REPLACE FUNCTION edmn_is_production() RETURNS boolean AS $$
  SELECT coalesce((SELECT environment = 'PRODUCTION' FROM deployment_environment WHERE id), false);
$$ LANGUAGE sql STABLE;--> statement-breakpoint
-- Once marked PRODUCTION a database can never be re-marked or unmarked.
CREATE OR REPLACE FUNCTION edmn_deployment_environment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.environment = 'PRODUCTION' AND (TG_OP = 'DELETE' OR NEW.environment <> 'PRODUCTION') THEN
    RAISE EXCEPTION 'a PRODUCTION database cannot be re-marked as %', CASE WHEN TG_OP = 'DELETE' THEN 'unmarked' ELSE NEW.environment END USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER deployment_environment_guard BEFORE UPDATE OR DELETE ON deployment_environment
  FOR EACH ROW EXECUTE FUNCTION edmn_deployment_environment_guard();--> statement-breakpoint
CREATE TRIGGER deployment_environment_no_truncate BEFORE TRUNCATE ON deployment_environment
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Demo (@demo.edmn.local, @edmn.local), E2E (@e2e.local) and test (@test.local) accounts all use the
-- reserved .local domain: never a real customer, seller or staff address.
CREATE OR REPLACE FUNCTION edmn_production_rejects_fixture_users() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS NOT NULL AND lower(NEW.email) LIKE '%.local' AND edmn_is_production() THEN
    RAISE EXCEPTION 'demo/test account % refused on a PRODUCTION database', NEW.email USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_production_fixture_guard BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION edmn_production_rejects_fixture_users();--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_production_rejects_test_destinations() RETURNS trigger AS $$
BEGIN
  IF NEW.is_test AND edmn_is_production() THEN
    RAISE EXCEPTION 'TEST payment destinations are refused on a PRODUCTION database' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payment_destinations_production_guard BEFORE INSERT OR UPDATE OF is_test ON payment_destinations
  FOR EACH ROW EXECUTE FUNCTION edmn_production_rejects_test_destinations();
