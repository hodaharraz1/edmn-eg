CREATE TABLE "alert_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"deadline_at" timestamp with time zone,
	"stage" text NOT NULL,
	"severity" text DEFAULT 'NORMAL' NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_stage_chk" CHECK ("alert_states"."stage" in ('PRE_DEADLINE', 'DUE', 'OVERDUE', 'RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "financial_movement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"approval_id" uuid,
	CONSTRAINT "financial_movement_requests_kind_chk" CHECK ("financial_movement_requests"."kind" in ('SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN')),
	CONSTRAINT "financial_movement_requests_status_chk" CHECK ("financial_movement_requests"."status" in ('PENDING', 'EXECUTED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "financial_movement_requests_amount_chk" CHECK ("financial_movement_requests"."amount" >= 0),
	CONSTRAINT "financial_movement_requests_checker_chk" CHECK ("financial_movement_requests"."decided_by" is null or "financial_movement_requests"."decided_by" <> "financial_movement_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "privileged_message_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"note" text NOT NULL,
	"case_type" text,
	"case_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privileged_message_access_purpose_chk" CHECK ("privileged_message_access"."purpose" in ('SUPPORT', 'DISPUTE', 'RISK', 'OPERATIONS', 'FINANCIAL_REVIEW'))
);
--> statement-breakpoint
CREATE TABLE "receiving_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"details_enc" text NOT NULL,
	"masked_label" text NOT NULL,
	"holder_name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_destinations_type_chk" CHECK ("receiving_destinations"."type" in ('BANK_ACCOUNT', 'MOBILE_WALLET')),
	CONSTRAINT "receiving_destinations_status_chk" CHECK ("receiving_destinations"."status" in ('PENDING_REVIEW', 'APPROVED', 'MORE_INFO_REQUIRED', 'REJECTED', 'REVERIFICATION_REQUIRED', 'ARCHIVED')),
	CONSTRAINT "receiving_destinations_approved_chk" CHECK ("receiving_destinations"."status" <> 'APPROVED' or ("receiving_destinations"."reviewed_by" is not null and "receiving_destinations"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_subject_chk" CHECK ("review_events"."subject_type" in ('IDENTITY', 'RECEIVING_DESTINATION'))
);
--> statement-breakpoint
CREATE TABLE "support_sla_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid,
	"trigger" text NOT NULL,
	"reopen_reason" text,
	"first_response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"first_response_breached" boolean,
	"resolution_breached" boolean
);
--> statement-breakpoint
CREATE TABLE "user_identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'INCOMPLETE' NOT NULL,
	"legal_name" text,
	"national_id_enc" text,
	"national_id_last4" text,
	"front_file_id" uuid,
	"back_file_id" uuid,
	"source" text DEFAULT 'SELF' NOT NULL,
	"legacy_seller_id" uuid,
	"submission_version" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identity_verifications_status_chk" CHECK ("user_identity_verifications"."status" in ('INCOMPLETE', 'PENDING_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'REVERIFICATION_REQUIRED')),
	CONSTRAINT "user_identity_verifications_source_chk" CHECK ("user_identity_verifications"."source" in ('SELF', 'LEGACY_SELLER_APPLICATION')),
	CONSTRAINT "user_identity_verifications_approved_chk" CHECK ("user_identity_verifications"."status" <> 'APPROVED' or ("user_identity_verifications"."reviewed_by" is not null and "user_identity_verifications"."front_file_id" is not null and "user_identity_verifications"."back_file_id" is not null and "user_identity_verifications"."national_id_enc" is not null and "user_identity_verifications"."legal_name" is not null))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_chk";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_type_chk";--> statement-breakpoint
ALTER TABLE "financial_approvals" DROP CONSTRAINT "financial_approvals_action_chk";--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_source" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "receiving_destination_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "receiving_destination_version" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_fingerprint" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_selection_reason" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "source_type" text DEFAULT 'MARKETPLACE' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "specialist_team" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "specialist_user_id" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "linked_type" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "linked_id" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "sla_cycle" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "resolution_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reopened_by" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "last_reopen_reason" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "qa_score" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "qa_note" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "qa_by" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "qa_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movement_requests" ADD CONSTRAINT "financial_movement_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_movement_requests" ADD CONSTRAINT "financial_movement_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_message_access" ADD CONSTRAINT "privileged_message_access_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_destinations" ADD CONSTRAINT "receiving_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_destinations" ADD CONSTRAINT "receiving_destinations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sla_cycles" ADD CONSTRAINT "support_sla_cycles_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_verifications" ADD CONSTRAINT "user_identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_verifications" ADD CONSTRAINT "user_identity_verifications_front_file_id_files_id_fk" FOREIGN KEY ("front_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_verifications" ADD CONSTRAINT "user_identity_verifications_back_file_id_files_id_fk" FOREIGN KEY ("back_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_verifications" ADD CONSTRAINT "user_identity_verifications_legacy_seller_id_sellers_id_fk" FOREIGN KEY ("legacy_seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_verifications" ADD CONSTRAINT "user_identity_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_states_key_uq" ON "alert_states" USING btree ("rule","entity_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "alert_states_open_idx" ON "alert_states" USING btree ("rule","stage") WHERE "alert_states"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_movement_requests_open_uq" ON "financial_movement_requests" USING btree ("kind","entity_id") WHERE "financial_movement_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "financial_movement_requests_status_idx" ON "financial_movement_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "privileged_message_access_actor_idx" ON "privileged_message_access" USING btree ("actor_user_id","conversation_id","expires_at");--> statement-breakpoint
CREATE INDEX "receiving_destinations_user_idx" ON "receiving_destinations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "receiving_destinations_status_idx" ON "receiving_destinations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_events_subject_idx" ON "review_events" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_sla_cycles_ticket_cycle_uq" ON "support_sla_cycles" USING btree ("ticket_id","cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_verifications_user_uq" ON "user_identity_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identity_verifications_status_idx" ON "user_identity_verifications" USING btree ("status","submitted_at");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_specialist_user_id_users_id_fk" FOREIGN KEY ("specialist_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_qa_by_users_id_fk" FOREIGN KEY ("qa_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_chk" CHECK ("files"."purpose" in ('PRODUCT_IMAGE', 'STORE_LOGO', 'STORE_BANNER', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'CMS_IMAGE', 'REVIEW_PHOTO', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'SHIPPING_WAYBILL', 'RETURN_EVIDENCE', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'SUPPORT_ATTACHMENT', 'MESSAGE_ATTACHMENT', 'IDENTITY_DOCUMENT'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_type_chk" CHECK ("support_tickets"."type" in ('ORDER', 'PAYMENT', 'SHIPPING', 'RETURN', 'PRODUCT', 'SELLER', 'EXTERNAL_DEAL', 'ACCOUNT', 'IDENTITY', 'RECEIVING_DESTINATION', 'REFUND', 'DISPUTE', 'SELLER_FINANCE', 'WITHDRAWAL', 'TECHNICAL'));--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'REFUND_REVOCATION'));--> statement-breakpoint
-- ═══════════ Batch 1.5: EVERY actual financial movement is two-person (no amount threshold), DB level ═══════════
-- Applies to NEW approvals only (BEFORE INSERT): historical approvals are never touched or re-validated.
-- Exempt (documented): PAYMENT_CONFIRMATION / DEAL_PAYMENT_CONFIRMATION (record money already received) and
-- WITHDRAWAL_RESERVATION (locks the seller's own balance; nothing leaves the platform).
CREATE OR REPLACE FUNCTION edmn_movement_requires_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW.action IN ('SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'REFUND_REVOCATION', 'WITHDRAWAL_RELEASE_RESERVATION',
                    'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_PAYOUT_RETURN', 'MANUAL_ADJUSTMENT', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT')
     AND NEW.status IN ('APPROVED', 'CONSUMED')
     AND (NOT NEW.dual_control OR NEW.requested_by IS NULL OR NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
    RAISE EXCEPTION 'financial movement % requires a maker and a different checker', NEW.action USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER financial_approvals_two_person BEFORE INSERT ON financial_approvals
  FOR EACH ROW EXECUTE FUNCTION edmn_movement_requires_two_people();--> statement-breakpoint
-- Movement requests: the maker, kind, entity and amount of a request never change; a decided request is final.
CREATE OR REPLACE FUNCTION edmn_movement_request_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.kind <> OLD.kind OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id OR NEW.amount <> OLD.amount
     OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'a financial movement request is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a decided financial movement request is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER financial_movement_requests_guard BEFORE UPDATE ON financial_movement_requests
  FOR EACH ROW EXECUTE FUNCTION edmn_movement_request_guard();--> statement-breakpoint
CREATE TRIGGER financial_movement_requests_no_delete BEFORE DELETE ON financial_movement_requests
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Receiving destinations: a version's owner / type / details / fingerprint never change (a change is a NEW version).
CREATE OR REPLACE FUNCTION edmn_receiving_destination_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.type <> OLD.type OR NEW.details_enc <> OLD.details_enc OR NEW.fingerprint <> OLD.fingerprint
     OR NEW.holder_name <> OLD.holder_name OR NEW.version <> OLD.version OR NEW.masked_label <> OLD.masked_label THEN
    RAISE EXCEPTION 'receiving destination details are immutable; submit a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'an archived receiving destination cannot be revived' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER receiving_destinations_guard BEFORE UPDATE ON receiving_destinations
  FOR EACH ROW EXECUTE FUNCTION edmn_receiving_destination_guard();--> statement-breakpoint
CREATE TRIGGER receiving_destinations_no_delete BEFORE DELETE ON receiving_destinations
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Review history, privileged message access grants and SLA cycle history are append-only / never deleted.
CREATE TRIGGER review_events_append_only BEFORE UPDATE OR DELETE ON review_events
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER privileged_message_access_append_only BEFORE UPDATE OR DELETE ON privileged_message_access
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER support_sla_cycles_no_delete BEFORE DELETE ON support_sla_cycles
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER user_identity_verifications_no_delete BEFORE DELETE ON user_identity_verifications
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();
