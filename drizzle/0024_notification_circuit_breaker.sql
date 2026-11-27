CREATE TABLE "notification_breakers" (
	"channel" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'CLOSED' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"next_probe_at" timestamp with time zone,
	"probe_lease_until" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_breakers_channel_chk" CHECK ("notification_breakers"."channel" in ('EMAIL', 'SMS')),
	CONSTRAINT "notification_breakers_state_chk" CHECK ("notification_breakers"."state" in ('CLOSED', 'OPEN', 'HALF_OPEN'))
);
