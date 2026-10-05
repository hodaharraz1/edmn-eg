ALTER TABLE "payment_destinations" ADD COLUMN "is_test" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "is_test" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "is_test" boolean DEFAULT true NOT NULL;