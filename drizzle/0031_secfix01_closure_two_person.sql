ALTER TABLE "account_closure_requests" ADD COLUMN "execution_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "account_closure_requests" ADD COLUMN "execution_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_closure_requests" ADD CONSTRAINT "account_closure_requests_execution_requested_by_users_id_fk" FOREIGN KEY ("execution_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- SEC-164: completing a closure is irreversible, so it is a two-person action: one staff member requests execution (Maker),
-- a DIFFERENT staff member completes it (Checker). NOT VALID: closures completed before this rule have no recorded maker and
-- must not block the migration (staging/production may already hold such rows). Every row written from now on IS checked.
ALTER TABLE "account_closure_requests" ADD CONSTRAINT "account_closure_two_person_chk" CHECK ("account_closure_requests"."status" <> 'COMPLETED' or ("account_closure_requests"."execution_requested_by" is not null and "account_closure_requests"."decided_by" is not null and "account_closure_requests"."execution_requested_by" <> "account_closure_requests"."decided_by")) NOT VALID;
