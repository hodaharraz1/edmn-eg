CREATE TABLE "deal_delivery_otps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"delivery_attempt" integer NOT NULL,
	"code_hash" text NOT NULL,
	"test_code_enc" text,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"invalidated_at" timestamp with time zone,
	"invalid_reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_delivery_otps_attempts_chk" CHECK ("deal_delivery_otps"."attempts" >= 0 and "deal_delivery_otps"."attempts" <= "deal_delivery_otps"."max_attempts")
);
--> statement-breakpoint
ALTER TABLE "external_deals" DROP CONSTRAINT "external_deals_status_chk";--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "delivery_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "handover_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "handover_otp_id" uuid;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "buyer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "delivery_conflict_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "financial_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD CONSTRAINT "deal_delivery_otps_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD CONSTRAINT "deal_delivery_otps_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD CONSTRAINT "deal_delivery_otps_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD CONSTRAINT "deal_delivery_otps_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_delivery_otps_deal_idx" ON "deal_delivery_otps" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_delivery_otps_active_uq" ON "deal_delivery_otps" USING btree ("deal_id") WHERE "deal_delivery_otps"."used_at" is null and "deal_delivery_otps"."invalidated_at" is null;--> statement-breakpoint
ALTER TABLE "external_deals" ADD CONSTRAINT "external_deals_status_chk" CHECK ("external_deals"."status" in ('DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'));--> statement-breakpoint
-- Delivery OTPs are evidence: never deleted; a used or invalidated code can never become usable again,
-- and the stored hash / binding never change.
CREATE OR REPLACE FUNCTION edmn_delivery_otp_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'delivery OTP records are append-only'; END IF;
  IF NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'delivery OTP binding is immutable';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
     OR (OLD.used_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
     OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'a used or invalidated delivery OTP cannot be reactivated';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deal_delivery_otps_guard BEFORE UPDATE OR DELETE ON deal_delivery_otps FOR EACH ROW EXECUTE FUNCTION edmn_delivery_otp_guard();
