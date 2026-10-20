CREATE TABLE "error_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"message" text NOT NULL,
	"source" text NOT NULL,
	"route" text,
	"last_request_id" text,
	"environment" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forwarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_leases" (
	"job_name" text PRIMARY KEY NOT NULL,
	"owner" text,
	"lease_until" timestamp with time zone NOT NULL,
	"every_seconds" integer,
	"last_started_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_expected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"run_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"worker" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"items_processed" integer,
	"items_failed" integer,
	"error_safe" text,
	"next_expected_at" timestamp with time zone,
	CONSTRAINT "job_runs_status_chk" CHECK ("job_runs"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED'))
);
--> statement-breakpoint
CREATE TABLE "ledger_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"debits" bigint NOT NULL,
	"credits" bigint NOT NULL,
	"difference" bigint NOT NULL,
	"critical_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warning_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger" text NOT NULL,
	CONSTRAINT "ledger_health_status_chk" CHECK ("ledger_health_checks"."status" in ('OK', 'WARNING', 'CRITICAL'))
);
--> statement-breakpoint
CREATE TABLE "secret_fingerprints" (
	"name" text PRIMARY KEY NOT NULL,
	"kcv" text NOT NULL,
	"environment" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "scan_status" text DEFAULT 'UNSCANNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "scan_engine" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "scan_detail" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "body_enc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "error_events_fingerprint_uq" ON "error_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_events_last_seen_idx" ON "error_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_run_id_uq" ON "job_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "job_runs_running_idx" ON "job_runs" USING btree ("status") WHERE "job_runs"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "ledger_health_checked_idx" ON "ledger_health_checks" USING btree ("checked_at");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_scan_status_chk" CHECK ("files"."scan_status" in ('UNSCANNED', 'QUARANTINED', 'SCANNING', 'CLEAN', 'INFECTED', 'REJECTED', 'SCAN_FAILED'));--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_status_chk" CHECK ("outbound_messages"."status" in ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED'));--> statement-breakpoint
-- Batch 2 custom: ledger health history is evidence (append-only); a recorded key fingerprint is never edited
-- in place (a rotation records a NEW key id; retiring an id is a reviewed runbook step).
CREATE TRIGGER ledger_health_checks_append_only BEFORE UPDATE OR DELETE ON ledger_health_checks
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER secret_fingerprints_no_update BEFORE UPDATE ON secret_fingerprints
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
