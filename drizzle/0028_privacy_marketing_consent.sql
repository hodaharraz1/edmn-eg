-- PKG-PRIVACY-01 (owner instruction 2026-11-25, phonemsg-01M89CKF3BYB4A9CNVAQN9DAR0): marketing consent OFF by default with dated consent log;
-- consenting-customer marketing export (5 fields only) behind a dedicated permission with two-person approval; every export stored encrypted and logged.
CREATE TABLE "marketing_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"request_reason" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"approved_by" uuid,
	"row_count" integer,
	"file_enc" text,
	"file_name" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	CONSTRAINT "marketing_exports_status_chk" CHECK ("marketing_exports"."status" in ('REQUESTED', 'EXECUTED', 'REJECTED')),
	CONSTRAINT "marketing_exports_two_person_chk" CHECK ("marketing_exports"."approved_by" is null or "marketing_exports"."approved_by" <> "marketing_exports"."requested_by")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_consent_events" ADD CONSTRAINT "marketing_consent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_exports" ADD CONSTRAINT "marketing_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_exports" ADD CONSTRAINT "marketing_exports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_consent_events_user_idx" ON "marketing_consent_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_exports_status_idx" ON "marketing_exports" USING btree ("status","requested_at");