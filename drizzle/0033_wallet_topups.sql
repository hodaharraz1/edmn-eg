-- PKG-WALLET-01 phase 1: customer wallet top-up. The 0031/0032 columns that drizzle-kit re-emits (account_closure_requests
-- execution_requested_*, files.purged_at) already exist from those migrations and are intentionally NOT repeated here;
-- the 0033 snapshot carries the full state.
CREATE TABLE "customer_wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"topup_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_wallet_entries_kind_chk" CHECK ("customer_wallet_entries"."kind" in ('TOPUP', 'SPEND', 'SPEND_REVERSAL')),
	CONSTRAINT "customer_wallet_entries_amount_chk" CHECK ("customer_wallet_entries"."amount" <> 0 and ("customer_wallet_entries"."kind" <> 'TOPUP' or "customer_wallet_entries"."amount" > 0) and ("customer_wallet_entries"."kind" <> 'SPEND' or "customer_wallet_entries"."amount" < 0) and ("customer_wallet_entries"."kind" <> 'SPEND_REVERSAL' or "customer_wallet_entries"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "wallet_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"proof_file_id" uuid NOT NULL,
	"proof_sha256" text,
	"payer_reference" text,
	"status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reject_reason" text,
	"journal_entry_id" uuid,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "wallet_topups_status_chk" CHECK ("wallet_topups"."status" in ('PENDING_REVIEW', 'CREDITED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "wallet_topups_method_chk" CHECK ("wallet_topups"."method" in ('BANK_TRANSFER', 'INSTAPAY')),
	CONSTRAINT "wallet_topups_amount_chk" CHECK ("wallet_topups"."amount" > 0),
	CONSTRAINT "wallet_topups_credited_chk" CHECK ("wallet_topups"."status" <> 'CREDITED' or ("wallet_topups"."journal_entry_id" is not null and "wallet_topups"."decided_by" is not null)),
	CONSTRAINT "wallet_topups_rejected_chk" CHECK ("wallet_topups"."status" <> 'REJECTED' or ("wallet_topups"."reject_reason" is not null and "wallet_topups"."decided_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "financial_approvals" DROP CONSTRAINT "financial_approvals_action_chk";--> statement-breakpoint
ALTER TABLE "financial_movement_requests" DROP CONSTRAINT "financial_movement_requests_kind_chk";--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_topup_id_wallet_topups_id_fk" FOREIGN KEY ("topup_id") REFERENCES "public"."wallet_topups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_proof_file_id_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_wallet_entries_user_idx" ON "customer_wallet_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_wallet_entries_topup_uq" ON "customer_wallet_entries" USING btree ("topup_id") WHERE "customer_wallet_entries"."topup_id" is not null;--> statement-breakpoint
CREATE INDEX "wallet_topups_user_idx" ON "wallet_topups" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_topups_status_idx" ON "wallet_topups" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_topups_client_key_uq" ON "wallet_topups" USING btree ("user_id","client_key");--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'REFUND_REVOCATION', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION', 'WALLET_TOPUP_CREDIT'));--> statement-breakpoint
ALTER TABLE "financial_movement_requests" ADD CONSTRAINT "financial_movement_requests_kind_chk" CHECK ("financial_movement_requests"."kind" in ('SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION', 'WALLET_TOPUP_CREDIT'));--> statement-breakpoint
-- Crediting a wallet moves money: it joins the DB-level two-person rule (exact superset of the 0030 definition).
CREATE OR REPLACE FUNCTION edmn_movement_requires_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW.action IN ('PAYMENT_CONFIRMATION', 'DEAL_PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'REFUND_REVOCATION', 'WITHDRAWAL_RELEASE_RESERVATION',
                    'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'MANUAL_ADJUSTMENT', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'COD_REMITTANCE', 'COD_SHORTAGE_RESOLUTION', 'WALLET_TOPUP_CREDIT')
     AND NEW.status IN ('APPROVED', 'CONSUMED')
     AND (NOT NEW.dual_control OR NEW.requested_by IS NULL OR NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
    RAISE EXCEPTION 'financial movement % requires a maker and a different checker', NEW.action USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- A decided deposit is final: CREDITED / REJECTED / CANCELLED never change again, and deposits are never deleted.
CREATE OR REPLACE FUNCTION edmn_wallet_topup_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'wallet top-ups are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'wallet top-up % is final (%)', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.amount <> OLD.amount OR NEW.method <> OLD.method OR NEW.proof_file_id <> OLD.proof_file_id THEN
    RAISE EXCEPTION 'wallet top-up % economics are immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER wallet_topups_guard BEFORE UPDATE OR DELETE ON wallet_topups
  FOR EACH ROW EXECUTE FUNCTION edmn_wallet_topup_guard();--> statement-breakpoint
CREATE TRIGGER wallet_topups_no_truncate BEFORE TRUNCATE ON wallet_topups
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- The per-user wallet sub-ledger is append-only evidence.
CREATE TRIGGER customer_wallet_entries_append_only BEFORE UPDATE OR DELETE ON customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER customer_wallet_entries_no_truncate BEFORE TRUNCATE ON customer_wallet_entries
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- A user's wallet can never go negative (checked at commit, so the SPEND row and its balance are judged together).
CREATE OR REPLACE FUNCTION edmn_wallet_nonnegative() RETURNS trigger AS $$
DECLARE bal bigint;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO bal FROM customer_wallet_entries WHERE user_id = NEW.user_id;
  IF bal < 0 THEN
    RAISE EXCEPTION 'wallet of user % would be negative (%)', NEW.user_id, bal USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_wallet_entries_nonnegative AFTER INSERT ON customer_wallet_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edmn_wallet_nonnegative();
