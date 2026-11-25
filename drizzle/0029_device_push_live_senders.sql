-- PKG-PUSH-02 (owner instruction 2026-11-25, phonemsg-01M89JZYZQBK3W5EQ1DJHETV2A): real push sending via Firebase/APNs, stays OFF,
-- keys from server settings ONLY (encrypted device_push_credentials), never in code; token provider column for FCM/APNS routing.
CREATE TABLE "device_push_credentials" (
	"provider" text PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_credentials_provider_chk" CHECK ("device_push_credentials"."provider" in ('FCM', 'APNS'))
);
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "device_push_credentials" ADD CONSTRAINT "device_push_credentials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;