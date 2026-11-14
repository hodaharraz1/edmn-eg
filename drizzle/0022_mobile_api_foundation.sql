CREATE TABLE "mobile_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"installation_id" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text,
	"app_version" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mobile_devices_app_chk" CHECK ("mobile_devices"."app" in ('CUSTOMER', 'ADMIN')),
	CONSTRAINT "mobile_devices_platform_chk" CHECK ("mobile_devices"."platform" in ('IOS', 'ANDROID'))
);
--> statement-breakpoint
CREATE TABLE "mobile_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_scope_chk";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_body" jsonb;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD COLUMN "code_hash_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_delivery_otps" ADD COLUMN "buyer_code_enc" text;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_refresh_tokens" ADD CONSTRAINT "mobile_refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_devices_user_idx" ON "mobile_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_installation_uq" ON "mobile_devices" USING btree ("user_id","app","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_refresh_tokens_hash_uq" ON "mobile_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mobile_refresh_tokens_session_idx" ON "mobile_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_chk" CHECK ("sessions"."scope" in ('WEB', 'ADMIN', 'MOBILE', 'ADMIN_MOBILE'));--> statement-breakpoint
-- Phase 1 (mobile): delivery OTPs keep every existing guarantee and add two more, enforced by the database:
--  * the hash version (which key material produced code_hash) is immutable, like the hash itself;
--  * the buyer's sealed in-app copy can only be cleared, never set again, and is destroyed automatically the moment
--    the code is used or invalidated (expired, regenerated, locked, closed).
CREATE OR REPLACE FUNCTION edmn_delivery_otp_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'delivery OTP records are append-only'; END IF;
  IF NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.code_hash_version IS DISTINCT FROM OLD.code_hash_version THEN
    RAISE EXCEPTION 'delivery OTP binding is immutable';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
     OR (OLD.used_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
     OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'a used or invalidated delivery OTP cannot be reactivated';
  END IF;
  IF NEW.buyer_code_enc IS NOT NULL AND NEW.buyer_code_enc IS DISTINCT FROM OLD.buyer_code_enc THEN
    RAISE EXCEPTION 'the sealed buyer copy of a delivery OTP can only be cleared';
  END IF;
  IF NEW.used_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL THEN
    NEW.buyer_code_enc := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
