-- SEC-04 M1: a privileged role is granted by TWO different super admins (Maker requests, a different Checker
-- approves) instead of one. `user_roles` rows are still written only by src/server/rbac/staff.ts, which refuses a
-- privileged grant without a matching APPROVED request; the constraints and guard trigger below make that record
-- impossible to forge from any other code path (self-approval, re-use after a decision, edited identity columns).
CREATE TABLE IF NOT EXISTS "privileged_role_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_user_id" uuid NOT NULL,
  "role_code" text NOT NULL,
  "requested_by" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_status_chk" CHECK ("privileged_role_requests"."status" in ('PENDING','APPROVED','REJECTED','CONSUMED','EXPIRED'));--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_two_people_chk" CHECK ("privileged_role_requests"."decided_by" is null or "privileged_role_requests"."decided_by" <> "privileged_role_requests"."requested_by");--> statement-breakpoint
ALTER TABLE "privileged_role_requests" ADD CONSTRAINT "privileged_role_requests_reason_len_chk" CHECK (char_length("privileged_role_requests"."reason") >= 10);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "privileged_role_requests_one_pending_idx" ON "privileged_role_requests" USING btree ("target_user_id","role_code") WHERE "privileged_role_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privileged_role_requests_target_idx" ON "privileged_role_requests" USING btree ("target_user_id");--> statement-breakpoint
-- A decision is final and the identity columns are immutable: an approved request cannot be re-pointed at another
-- user or role, and a request cannot be approved by its own requester (the CHECK above is the second line).
CREATE OR REPLACE FUNCTION edmn_privileged_role_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_user_id <> OLD.target_user_id OR NEW.role_code <> OLD.role_code OR NEW.requested_by <> OLD.requested_by OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'privileged role request identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'privileged role request is already decided' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('APPROVED','REJECTED') AND (NEW.decided_by IS NULL OR NEW.decided_by = NEW.requested_by OR NEW.decided_at IS NULL) THEN
    RAISE EXCEPTION 'a privileged role decision needs a different second person' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS privileged_role_requests_guard ON "privileged_role_requests";--> statement-breakpoint
CREATE TRIGGER privileged_role_requests_guard BEFORE UPDATE ON "privileged_role_requests" FOR EACH ROW EXECUTE FUNCTION edmn_privileged_role_request_guard();--> statement-breakpoint
-- Nobody grants a role to their own account, from any path.
CREATE OR REPLACE FUNCTION edmn_user_roles_no_self_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.granted_by IS NOT NULL AND NEW.granted_by = NEW.user_id THEN
    RAISE EXCEPTION 'a staff member cannot grant a role to their own account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS user_roles_no_self_grant ON "user_roles";--> statement-breakpoint
CREATE TRIGGER user_roles_no_self_grant BEFORE INSERT ON "user_roles" FOR EACH ROW EXECUTE FUNCTION edmn_user_roles_no_self_grant();
