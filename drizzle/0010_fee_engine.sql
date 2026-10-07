CREATE TABLE "payout_channel_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cost_bps" integer DEFAULT 0 NOT NULL,
	"cost_fixed" bigint DEFAULT 0 NOT NULL,
	"cost_min" bigint DEFAULT 0 NOT NULL,
	"cost_max" bigint,
	"payer_policy" text DEFAULT 'SELLER_PAYS' NOT NULL,
	"tax_treatment" text DEFAULT 'UNRESOLVED' NOT NULL,
	"max_per_transaction" bigint,
	"max_per_day" bigint,
	"max_per_month" bigint,
	"recipient_max_per_day" bigint,
	"recipient_max_per_month" bigint,
	"warning_threshold_bps" integer DEFAULT 8000 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"notes" text,
	"source_reference" text,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_channel_configs_channel_chk" CHECK ("payout_channel_configs"."channel" in ('INSTAPAY', 'BANK_TRANSFER', 'MOBILE_WALLET', 'FUTURE_PSP', 'OTHER')),
	CONSTRAINT "payout_channel_configs_payer_chk" CHECK ("payout_channel_configs"."payer_policy" in ('SELLER_PAYS', 'EDMN_PAYS')),
	CONSTRAINT "payout_channel_configs_cost_chk" CHECK ("payout_channel_configs"."cost_bps" between 0 and 10000 and "payout_channel_configs"."cost_fixed" >= 0 and "payout_channel_configs"."cost_min" >= 0 and ("payout_channel_configs"."cost_max" is null or "payout_channel_configs"."cost_max" >= "payout_channel_configs"."cost_min")),
	CONSTRAINT "payout_channel_configs_dates_chk" CHECK ("payout_channel_configs"."effective_to" is null or "payout_channel_configs"."effective_to" > "payout_channel_configs"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "pricing_category_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"economic_class" text NOT NULL,
	CONSTRAINT "pricing_category_classes_class_chk" CHECK ("pricing_category_classes"."economic_class" in ('LOW_MARGIN', 'STANDARD', 'HIGH_MARGIN'))
);
--> statement-breakpoint
CREATE TABLE "pricing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"economic_class" text NOT NULL,
	"seq" integer NOT NULL,
	"lower_bound" bigint NOT NULL,
	"upper_bound" bigint,
	"buyer_bps" integer NOT NULL,
	"seller_bps" integer NOT NULL,
	"total_bps" integer NOT NULL,
	CONSTRAINT "pricing_tiers_split_chk" CHECK ("pricing_tiers"."buyer_bps" + "pricing_tiers"."seller_bps" = "pricing_tiers"."total_bps"),
	CONSTRAINT "pricing_tiers_rates_chk" CHECK ("pricing_tiers"."buyer_bps" >= 0 and "pricing_tiers"."seller_bps" >= 0 and "pricing_tiers"."total_bps" between 0 and 10000),
	CONSTRAINT "pricing_tiers_bounds_chk" CHECK ("pricing_tiers"."lower_bound" >= 0 and ("pricing_tiers"."upper_bound" is null or "pricing_tiers"."upper_bound" > "pricing_tiers"."lower_bound")),
	CONSTRAINT "pricing_tiers_class_chk" CHECK ("pricing_tiers"."economic_class" in ('LOW_MARGIN','STANDARD','HIGH_MARGIN','DEAL'))
);
--> statement-breakpoint
CREATE TABLE "pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"version_no" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"min_fee" bigint NOT NULL,
	"min_fee_allocation" text DEFAULT 'PROPORTIONAL' NOT NULL,
	"rounding" text DEFAULT 'TOTAL_HALF_UP__BUYER_HALF_UP__SELLER_REMAINDER' NOT NULL,
	"shipping_in_fee_base" boolean DEFAULT false NOT NULL,
	"target_margin_bps" integer DEFAULT 5000 NOT NULL,
	"assumptions" jsonb NOT NULL,
	"tax_treatment" text DEFAULT 'UNRESOLVED' NOT NULL,
	"notes" text,
	"cloned_from_id" uuid,
	"effective_from" timestamp with time zone,
	"expected_margin_bps" integer,
	"created_by" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"margin_override" boolean DEFAULT false NOT NULL,
	"margin_override_by" uuid,
	"margin_override_reason" text,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"publish_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"config_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_versions_model_chk" CHECK ("pricing_versions"."model" in ('MARKETPLACE', 'PROTECTED_DEAL')),
	CONSTRAINT "pricing_versions_status_chk" CHECK ("pricing_versions"."status" in ('DRAFT', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'CANCELLED')),
	CONSTRAINT "pricing_versions_tax_chk" CHECK ("pricing_versions"."tax_treatment" in ('UNRESOLVED', 'FEES_INCLUDE_VAT', 'VAT_ADDED', 'EXEMPT')),
	CONSTRAINT "pricing_versions_currency_chk" CHECK ("pricing_versions"."currency" = 'EGP'),
	CONSTRAINT "pricing_versions_min_chk" CHECK ("pricing_versions"."min_fee" >= 0),
	CONSTRAINT "pricing_versions_target_chk" CHECK ("pricing_versions"."target_margin_bps" between 0 and 10000),
	CONSTRAINT "pricing_versions_maker_checker_chk" CHECK ("pricing_versions"."approved_by" is null or "pricing_versions"."validated_by" is null or "pricing_versions"."approved_by" <> "pricing_versions"."validated_by"),
	CONSTRAINT "pricing_versions_published_chk" CHECK ("pricing_versions"."status" <> 'PUBLISHED' or ("pricing_versions"."effective_from" is not null and "pricing_versions"."approved_by" is not null and "pricing_versions"."published_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "refund_fee_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"lifecycle_stage" text NOT NULL,
	"reason_code" text NOT NULL,
	"responsible_party" text NOT NULL,
	"buyer_fee_refund_bps" integer NOT NULL,
	"seller_fee_reversal_bps" integer NOT NULL,
	"shipping_refund" text NOT NULL,
	"return_shipping_payer" text NOT NULL,
	"transfer_cost_payer" text NOT NULL,
	"manual_review" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "refund_fee_policy_rules_bps_chk" CHECK ("refund_fee_policy_rules"."buyer_fee_refund_bps" between 0 and 10000 and "refund_fee_policy_rules"."seller_fee_reversal_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "refund_fee_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"legal_review_required" boolean DEFAULT true NOT NULL,
	"legal_policy_version" text,
	"notes" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"publish_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_fee_policy_versions_status_chk" CHECK ("refund_fee_policy_versions"."status" in ('DRAFT', 'PUBLISHED', 'RETIRED')),
	CONSTRAINT "refund_fee_policy_versions_legal_chk" CHECK ("refund_fee_policy_versions"."status" <> 'PUBLISHED' or "refund_fee_policy_versions"."legal_review_required" = false)
);
--> statement-breakpoint
CREATE TABLE "transaction_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"cost_type" text NOT NULL,
	"nature" text NOT NULL,
	"borne_by" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"journal_entry_id" uuid,
	"notes" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_costs_type_chk" CHECK ("transaction_costs"."cost_type" in ('COLLECTION', 'PAYOUT_TRANSFER', 'REFUND_TRANSFER', 'RETURN_DIRECT', 'DISPUTE_DIRECT', 'PROVIDER', 'OTHER')),
	CONSTRAINT "transaction_costs_nature_chk" CHECK ("transaction_costs"."nature" in ('ACTUAL', 'ESTIMATE')),
	CONSTRAINT "transaction_costs_bearer_chk" CHECK ("transaction_costs"."borne_by" in ('EDMN', 'SELLER', 'BUYER')),
	CONSTRAINT "transaction_costs_amount_chk" CHECK ("transaction_costs"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "economic_class" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "pricing_version_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "responsible_party" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "lifecycle_stage" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "fee_policy_version_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "fee_policy_source" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "transfer_cost" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "transfer_cost_borne_by" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "pricing_source" text DEFAULT 'LEGACY_SNAPSHOT' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "pricing_version_id" uuid;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "buyer_fee_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_fee_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "pricing_source" text DEFAULT 'LEGACY_SNAPSHOT' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "pricing_version_id" uuid;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "payout_channel" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "payout_channel_config_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_cost_payer" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_cost" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "net_transfer_amount" bigint;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "actual_transfer_cost" bigint;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "transfer_cost_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payout_channel_configs" ADD CONSTRAINT "payout_channel_configs_last_reviewed_by_users_id_fk" FOREIGN KEY ("last_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_channel_configs" ADD CONSTRAINT "payout_channel_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_category_classes" ADD CONSTRAINT "pricing_category_classes_version_id_pricing_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_category_classes" ADD CONSTRAINT "pricing_category_classes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_tiers" ADD CONSTRAINT "pricing_tiers_version_id_pricing_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_margin_override_by_users_id_fk" FOREIGN KEY ("margin_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_fee_policy_rules" ADD CONSTRAINT "refund_fee_policy_rules_version_id_refund_fee_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."refund_fee_policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_fee_policy_versions" ADD CONSTRAINT "refund_fee_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_fee_policy_versions" ADD CONSTRAINT "refund_fee_policy_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_costs" ADD CONSTRAINT "transaction_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_channel_configs_version_uq" ON "payout_channel_configs" USING btree ("channel","version");--> statement-breakpoint
CREATE INDEX "payout_channel_configs_lookup_idx" ON "payout_channel_configs" USING btree ("channel","is_active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_category_classes_uq" ON "pricing_category_classes" USING btree ("version_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_tiers_seq_uq" ON "pricing_tiers" USING btree ("version_id","economic_class","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_versions_no_uq" ON "pricing_versions" USING btree ("model","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_versions_effective_uq" ON "pricing_versions" USING btree ("model","effective_from") WHERE "pricing_versions"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "pricing_versions_lookup_idx" ON "pricing_versions" USING btree ("model","status","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_fee_policy_rules_uq" ON "refund_fee_policy_rules" USING btree ("version_id","lifecycle_stage","reason_code","responsible_party");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_fee_policy_versions_no_uq" ON "refund_fee_policy_versions" USING btree ("version_no");--> statement-breakpoint
CREATE INDEX "transaction_costs_entity_idx" ON "transaction_costs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_costs_idem_uq" ON "transaction_costs" USING btree ("idempotency_key");--> statement-breakpoint
-- ═══ Fee engine guards (additive; no existing row is modified) ═══
-- Tiers and category classes can only change while their version is a DRAFT.
CREATE OR REPLACE FUNCTION edmn_pricing_child_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM pricing_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'pricing version is % — only DRAFT versions can be edited (create a new version)', st USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    RAISE EXCEPTION 'pricing rows cannot move between versions' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER pricing_tiers_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing_tiers FOR EACH ROW EXECUTE FUNCTION edmn_pricing_child_guard();--> statement-breakpoint
CREATE TRIGGER pricing_category_classes_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing_category_classes FOR EACH ROW EXECUTE FUNCTION edmn_pricing_child_guard();--> statement-breakpoint
-- Published versions are immutable (a not-yet-effective one may only be cancelled); validated /
-- approved versions keep their economics (editing means re-opening as DRAFT, which clears approvals).
CREATE OR REPLACE FUNCTION edmn_pricing_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pricing versions are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.model <> OLD.model OR NEW.version_no <> OLD.version_no THEN
    RAISE EXCEPTION 'pricing version identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled pricing version is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.status = 'CANCELLED' AND OLD.effective_from > now()
       AND NEW.min_fee = OLD.min_fee AND NEW.assumptions = OLD.assumptions AND NEW.effective_from = OLD.effective_from
       AND NEW.target_margin_bps = OLD.target_margin_bps AND NEW.config_hash IS NOT DISTINCT FROM OLD.config_hash THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'published pricing version % is immutable (create a new version)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('VALIDATED','APPROVED') AND NEW.status = OLD.status
     AND (NEW.min_fee <> OLD.min_fee OR NEW.assumptions <> OLD.assumptions OR NEW.target_margin_bps <> OLD.target_margin_bps
          OR NEW.currency <> OLD.currency OR NEW.shipping_in_fee_base <> OLD.shipping_in_fee_base OR NEW.config_hash IS DISTINCT FROM OLD.config_hash) THEN
    RAISE EXCEPTION 'validated/approved pricing economics cannot change; re-open the version as DRAFT' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER pricing_versions_guard BEFORE UPDATE OR DELETE ON pricing_versions FOR EACH ROW EXECUTE FUNCTION edmn_pricing_version_guard();--> statement-breakpoint
-- Payout channel cost/limit versions: only activation state, closing date and review stamp may change.
CREATE OR REPLACE FUNCTION edmn_payout_channel_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout channel configurations are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'is_active' - 'effective_to' - 'last_reviewed_at' - 'last_reviewed_by')
     <> (to_jsonb(OLD) - 'is_active' - 'effective_to' - 'last_reviewed_at' - 'last_reviewed_by') THEN
    RAISE EXCEPTION 'payout channel configuration % is a version: create a new one', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payout_channel_configs_guard BEFORE UPDATE OR DELETE ON payout_channel_configs FOR EACH ROW EXECUTE FUNCTION edmn_payout_channel_guard();--> statement-breakpoint
CREATE TRIGGER transaction_costs_append_only BEFORE UPDATE OR DELETE ON transaction_costs FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Refund policy rules change only while their version is a DRAFT; versions are never deleted.
CREATE OR REPLACE FUNCTION edmn_refund_policy_child_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM refund_fee_policy_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'refund fee policy version is % — rules are frozen', st USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER refund_fee_policy_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON refund_fee_policy_rules FOR EACH ROW EXECUTE FUNCTION edmn_refund_policy_child_guard();--> statement-breakpoint
CREATE TRIGGER refund_fee_policy_versions_no_delete BEFORE DELETE ON refund_fee_policy_versions FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Committed pricing snapshots never change (orders, deals); a withdrawal's transfer-cost quote is frozen at approval.
CREATE OR REPLACE FUNCTION edmn_pricing_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.pricing_snapshot IS NOT NULL AND NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot THEN
    RAISE EXCEPTION 'pricing snapshot of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Source/version are set once together with the first snapshot (a deal freezes its quote at agreement).
  IF OLD.pricing_snapshot IS NOT NULL AND (NEW.pricing_source IS DISTINCT FROM OLD.pricing_source OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id) THEN
    RAISE EXCEPTION 'pricing source/version of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER seller_orders_pricing_guard BEFORE UPDATE ON seller_orders FOR EACH ROW EXECUTE FUNCTION edmn_pricing_snapshot_guard();--> statement-breakpoint
CREATE TRIGGER external_deals_pricing_guard BEFORE UPDATE ON external_deals FOR EACH ROW EXECUTE FUNCTION edmn_pricing_snapshot_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_withdrawal_cost_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.reserved_at IS NOT NULL AND (NEW.transfer_cost <> OLD.transfer_cost OR NEW.transfer_cost_snapshot IS DISTINCT FROM OLD.transfer_cost_snapshot
     OR NEW.transfer_cost_payer IS DISTINCT FROM OLD.transfer_cost_payer OR NEW.payout_channel_config_id IS DISTINCT FROM OLD.payout_channel_config_id) THEN
    RAISE EXCEPTION 'withdrawal % transfer cost is frozen after approval', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.actual_transfer_cost IS NOT NULL AND NEW.actual_transfer_cost IS DISTINCT FROM OLD.actual_transfer_cost THEN
    RAISE EXCEPTION 'withdrawal % actual transfer cost is final', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_cost_guard BEFORE UPDATE ON withdrawal_requests FOR EACH ROW EXECUTE FUNCTION edmn_withdrawal_cost_guard();--> statement-breakpoint
-- One-time grant of the new pricing permissions to the default roles (editable afterwards).
INSERT INTO role_permissions (role_code, permission)
SELECT r.code, p.permission FROM roles r
JOIN (VALUES
  ('SUPER_ADMIN','pricing.view'), ('SUPER_ADMIN','pricing.draft'), ('SUPER_ADMIN','pricing.simulate'), ('SUPER_ADMIN','pricing.submit'),
  ('SUPER_ADMIN','pricing.approve'), ('SUPER_ADMIN','pricing.publish'), ('SUPER_ADMIN','pricing.override_margin_guard'),
  ('SUPER_ADMIN','payout_costs.manage'), ('SUPER_ADMIN','refund_fee_policy.manage'), ('SUPER_ADMIN','profitability.view'),
  ('FINANCE_OPERATOR','pricing.view'), ('FINANCE_OPERATOR','pricing.draft'), ('FINANCE_OPERATOR','pricing.simulate'),
  ('FINANCE_OPERATOR','pricing.submit'), ('FINANCE_OPERATOR','profitability.view'),
  ('FINANCE_CHECKER','pricing.view'), ('FINANCE_CHECKER','pricing.simulate'), ('FINANCE_CHECKER','pricing.approve'),
  ('FINANCE_CHECKER','pricing.publish'), ('FINANCE_CHECKER','payout_costs.manage'), ('FINANCE_CHECKER','refund_fee_policy.manage'),
  ('FINANCE_CHECKER','profitability.view')
) AS p(role_code, permission) ON p.role_code = r.code
ON CONFLICT DO NOTHING;
