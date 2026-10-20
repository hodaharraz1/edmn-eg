CREATE TABLE "provider_health" (
	"provider" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_safe" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
