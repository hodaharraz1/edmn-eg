CREATE TABLE "condition_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"passport_id" uuid NOT NULL,
	"deal_id" uuid,
	"seller_order_id" uuid,
	"terms_version" integer,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"hash" text NOT NULL,
	"prev_hash" text,
	"proposed_by" uuid,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condition_snapshots_subject_chk" CHECK (num_nonnulls("condition_snapshots"."deal_id", "condition_snapshots"."seller_order_id") = 1),
	CONSTRAINT "condition_snapshots_status_chk" CHECK ("condition_snapshots"."status" in ('PROPOSED', 'ACCEPTED', 'SUPERSEDED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "product_passport_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_passports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"report_id" uuid NOT NULL,
	"product_id" uuid,
	"deal_id" uuid,
	"identifier_hash" text,
	"level" text DEFAULT 'PROTECTED' NOT NULL,
	"verification_status" text DEFAULT 'UNREVIEWED' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_passports_code_unique" UNIQUE("code"),
	CONSTRAINT "product_passports_reportId_unique" UNIQUE("report_id"),
	CONSTRAINT "product_passports_level_chk" CHECK ("product_passports"."level" in ('PROTECTED', 'VERIFIED', 'INSPECTED')),
	CONSTRAINT "product_passports_verification_chk" CHECK ("product_passports"."verification_status" in ('UNREVIEWED', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "used_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject_ref" uuid,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_analytics_name_chk" CHECK ("used_analytics_events"."name" in ('USED_LISTING_STARTED', 'USED_LISTING_COMPLETED', 'EXTERNAL_DEAL_CREATED', 'DEAL_INVITE_CLAIMED', 'SELLER_OFFER_SUBMITTED', 'CONDITION_FROZEN', 'INSPECTION_STARTED', 'BUYER_ACCEPTED', 'INSPECTION_DISPUTE_OPENED', 'PASSPORT_VERIFIED', 'INSPECTION_RECORDED'))
);
--> statement-breakpoint
CREATE TABLE "used_category_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_category_policies_categoryId_unique" UNIQUE("category_id")
);
--> statement-breakpoint
CREATE TABLE "used_condition_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_condition_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"product_id" uuid,
	"deal_id" uuid,
	"author_user_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identifier_enc" text,
	"identifier_masked" text,
	"identifier_hash" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"declared_at" timestamp with time zone,
	"condition_completeness" integer DEFAULT 0 NOT NULL,
	"evidence_completeness" integer DEFAULT 0 NOT NULL,
	"defects_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_reports_subject_chk" CHECK (num_nonnulls("used_condition_reports"."product_id", "used_condition_reports"."deal_id") = 1),
	CONSTRAINT "used_reports_status_chk" CHECK ("used_condition_reports"."status" in ('DRAFT', 'DECLARED', 'LOCKED'))
);
--> statement-breakpoint
CREATE TABLE "used_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"inspector_name" text NOT NULL,
	"result" text NOT NULL,
	"summary" text NOT NULL,
	"report_file_id" uuid NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_inspections_result_chk" CHECK ("used_inspections"."result" in ('PASS', 'PASS_WITH_NOTES', 'FAIL'))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_chk";--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_report_id_used_condition_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."used_condition_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_passport_id_product_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."product_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_snapshots" ADD CONSTRAINT "condition_snapshots_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passport_events" ADD CONSTRAINT "product_passport_events_passport_id_product_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."product_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passport_events" ADD CONSTRAINT "product_passport_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passports" ADD CONSTRAINT "product_passports_report_id_used_condition_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."used_condition_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passports" ADD CONSTRAINT "product_passports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passports" ADD CONSTRAINT "product_passports_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_passports" ADD CONSTRAINT "product_passports_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_category_policies" ADD CONSTRAINT "used_category_policies_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_category_policies" ADD CONSTRAINT "used_category_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_evidence" ADD CONSTRAINT "used_condition_evidence_report_id_used_condition_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."used_condition_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_evidence" ADD CONSTRAINT "used_condition_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_evidence" ADD CONSTRAINT "used_condition_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_reports" ADD CONSTRAINT "used_condition_reports_policy_id_used_category_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."used_category_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_reports" ADD CONSTRAINT "used_condition_reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_reports" ADD CONSTRAINT "used_condition_reports_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_condition_reports" ADD CONSTRAINT "used_condition_reports_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_inspections" ADD CONSTRAINT "used_inspections_passport_id_product_passports_id_fk" FOREIGN KEY ("passport_id") REFERENCES "public"."product_passports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_inspections" ADD CONSTRAINT "used_inspections_report_file_id_files_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_inspections" ADD CONSTRAINT "used_inspections_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "condition_snapshots_deal_version_uq" ON "condition_snapshots" USING btree ("deal_id","version") WHERE "condition_snapshots"."deal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "condition_snapshots_order_uq" ON "condition_snapshots" USING btree ("seller_order_id","report_id","version") WHERE "condition_snapshots"."seller_order_id" is not null;--> statement-breakpoint
CREATE INDEX "condition_snapshots_report_idx" ON "condition_snapshots" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "passport_events_idx" ON "product_passport_events" USING btree ("passport_id","created_at");--> statement-breakpoint
CREATE INDEX "product_passports_identifier_idx" ON "product_passports" USING btree ("identifier_hash");--> statement-breakpoint
CREATE INDEX "used_analytics_name_idx" ON "used_analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "used_evidence_file_uq" ON "used_condition_evidence" USING btree ("report_id","file_id");--> statement-breakpoint
CREATE INDEX "used_evidence_report_idx" ON "used_condition_evidence" USING btree ("report_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "used_reports_product_uq" ON "used_condition_reports" USING btree ("product_id") WHERE "used_condition_reports"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "used_reports_deal_uq" ON "used_condition_reports" USING btree ("deal_id") WHERE "used_condition_reports"."deal_id" is not null;--> statement-breakpoint
CREATE INDEX "used_reports_identifier_idx" ON "used_condition_reports" USING btree ("identifier_hash");--> statement-breakpoint
CREATE INDEX "used_inspections_passport_idx" ON "used_inspections" USING btree ("passport_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_chk" CHECK ("files"."purpose" in ('PRODUCT_IMAGE', 'STORE_LOGO', 'STORE_BANNER', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'CMS_IMAGE', 'REVIEW_PHOTO', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'SHIPPING_WAYBILL', 'RETURN_EVIDENCE', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'SUPPORT_ATTACHMENT', 'MESSAGE_ATTACHMENT', 'IDENTITY_DOCUMENT', 'CONDITION_EVIDENCE'));--> statement-breakpoint
-- Product Condition Freeze: snapshot content is immutable and never deleted; only the agreement status moves forward
-- (PROPOSED → ACCEPTED | SUPERSEDED | REJECTED, ACCEPTED → SUPERSEDED).
CREATE OR REPLACE FUNCTION edmn_condition_snapshots_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'condition snapshots are append-only'; END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.report_id IS DISTINCT FROM OLD.report_id OR NEW.passport_id IS DISTINCT FROM OLD.passport_id
     OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.seller_order_id IS DISTINCT FROM OLD.seller_order_id OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'condition snapshot content is immutable (snapshot %)', OLD.id;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'PROPOSED' AND NEW.status IN ('ACCEPTED', 'SUPERSEDED', 'REJECTED')) OR (OLD.status = 'ACCEPTED' AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'invalid condition snapshot transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER condition_snapshots_guard BEFORE UPDATE OR DELETE ON condition_snapshots FOR EACH ROW EXECUTE FUNCTION edmn_condition_snapshots_guard();
--> statement-breakpoint
-- Passport history and recorded inspections are history: append-only.
CREATE OR REPLACE FUNCTION edmn_used_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER product_passport_events_append_only BEFORE UPDATE OR DELETE ON product_passport_events FOR EACH ROW EXECUTE FUNCTION edmn_used_append_only();
--> statement-breakpoint
CREATE TRIGGER used_inspections_append_only BEFORE UPDATE OR DELETE ON used_inspections FOR EACH ROW EXECUTE FUNCTION edmn_used_append_only();
--> statement-breakpoint
-- A LOCKED condition report (agreed in a deal) can never be edited, unlocked or have its evidence changed.
CREATE OR REPLACE FUNCTION edmn_used_report_lock() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'LOCKED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.answers IS DISTINCT FROM OLD.answers
     OR NEW.identifier_enc IS DISTINCT FROM OLD.identifier_enc OR NEW.identifier_hash IS DISTINCT FROM OLD.identifier_hash
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id) THEN
    RAISE EXCEPTION 'condition report % is locked', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER used_condition_reports_lock BEFORE UPDATE ON used_condition_reports FOR EACH ROW EXECUTE FUNCTION edmn_used_report_lock();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_used_evidence_lock() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM used_condition_reports WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  IF st = 'LOCKED' THEN RAISE EXCEPTION 'evidence of a locked condition report cannot change'; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'condition evidence rows are not updatable'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER used_condition_evidence_lock BEFORE INSERT OR UPDATE OR DELETE ON used_condition_evidence FOR EACH ROW EXECUTE FUNCTION edmn_used_evidence_lock();
