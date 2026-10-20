CREATE TABLE "withdrawal_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"withdrawal_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"user_id" uuid,
	"seller_id" uuid,
	"source_type" text NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"deal_id" uuid,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"restored_amount" bigint DEFAULT 0 NOT NULL,
	"reservation_journal_id" uuid,
	"payout_journal_id" uuid,
	"release_journal_id" uuid,
	"return_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_allocations_source_chk" CHECK ("withdrawal_allocations"."source_type" in ('MARKETPLACE', 'PROTECTED_DEAL')),
	CONSTRAINT "withdrawal_allocations_status_chk" CHECK ("withdrawal_allocations"."status" in ('RESERVED', 'PAID', 'RELEASED', 'RETURNED')),
	CONSTRAINT "withdrawal_allocations_amount_chk" CHECK ("withdrawal_allocations"."amount" > 0),
	CONSTRAINT "withdrawal_allocations_restored_chk" CHECK ("withdrawal_allocations"."restored_amount" >= 0 and "withdrawal_allocations"."restored_amount" <= "withdrawal_allocations"."amount")
);
--> statement-breakpoint
ALTER TABLE "receiving_destinations" DROP CONSTRAINT "receiving_destinations_type_chk";--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ALTER COLUMN "seller_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "receiving_destination_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_allocations" ADD CONSTRAINT "withdrawal_allocations_withdrawal_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_allocations" ADD CONSTRAINT "withdrawal_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_allocations" ADD CONSTRAINT "withdrawal_allocations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_allocations_seq_uq" ON "withdrawal_allocations" USING btree ("withdrawal_id","seq");--> statement-breakpoint
CREATE INDEX "withdrawal_allocations_source_idx" ON "withdrawal_allocations" USING btree ("source_entity_type","source_entity_id","status");--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_user_client_key_uq" ON "withdrawal_requests" USING btree ("user_id","client_key") WHERE "withdrawal_requests"."seller_id" is null;--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawal_requests" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawals_source_type_chk" CHECK ("withdrawal_requests"."source_type" in ('MARKETPLACE', 'PROTECTED_DEAL', 'MIXED'));--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawals_owner_chk" CHECK ("withdrawal_requests"."seller_id" is not null or "withdrawal_requests"."user_id" is not null);--> statement-breakpoint
ALTER TABLE "receiving_destinations" ADD CONSTRAINT "receiving_destinations_type_chk" CHECK ("receiving_destinations"."type" in ('BANK_ACCOUNT', 'MOBILE_WALLET', 'INSTAPAY'));--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_receiving_destination_fk" FOREIGN KEY ("receiving_destination_id") REFERENCES "public"."receiving_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ═══════════ Batch 1.5 closure: withdrawal source allocations are permanent attribution records ═══════════
-- The withdrawal, order, source and amount of an allocation never change; only its lifecycle moves forward
-- (RESERVED → PAID | RELEASED, PAID → RETURNED) and the restored amount is recorded once. Never deleted.
CREATE OR REPLACE FUNCTION edmn_withdrawal_allocation_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.withdrawal_id <> OLD.withdrawal_id OR NEW.seq <> OLD.seq OR NEW.source_type <> OLD.source_type
     OR NEW.source_entity_type <> OLD.source_entity_type OR NEW.source_entity_id <> OLD.source_entity_id
     OR NEW.amount <> OLD.amount OR NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    RAISE EXCEPTION 'a withdrawal allocation is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.status = NEW.status)
       OR (OLD.status = 'RESERVED' AND NEW.status IN ('PAID', 'RELEASED'))
       OR (OLD.status = 'PAID' AND NEW.status = 'RETURNED')) THEN
    RAISE EXCEPTION 'invalid withdrawal allocation transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER withdrawal_allocations_guard BEFORE UPDATE ON withdrawal_allocations
  FOR EACH ROW EXECUTE FUNCTION edmn_withdrawal_allocation_guard();--> statement-breakpoint
CREATE TRIGGER withdrawal_allocations_no_delete BEFORE DELETE ON withdrawal_allocations
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
