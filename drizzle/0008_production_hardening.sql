CREATE TABLE "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_requests_status_chk" CHECK ("cancellation_requests"."status" in ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'))
);
--> statement-breakpoint
CREATE TABLE "delivery_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"file_id" uuid,
	"carrier_reference" text,
	"note" text,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"principal" bigint NOT NULL,
	"buyer_fee" bigint DEFAULT 0 NOT NULL,
	"seller_fee" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_items_qty_chk" CHECK ("refund_items"."quantity" > 0 and "refund_items"."principal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_closure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_status_chk" CHECK ("account_closure_requests"."status" in ('BLOCKED', 'PENDING', 'COMPLETED', 'WITHDRAWN'))
);
--> statement-breakpoint
CREATE TABLE "external_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"external_ref" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"counterparty" text,
	"state" text DEFAULT 'UNMATCHED' NOT NULL,
	"matched_type" text,
	"matched_id" uuid,
	"journal_entry_id" uuid,
	"suggestion" jsonb,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_tx_state_chk" CHECK ("external_transactions"."state" in ('UNMATCHED', 'SUGGESTED_MATCH', 'MATCHED', 'MISMATCH', 'IGNORED_WITH_REASON')),
	CONSTRAINT "external_tx_amount_chk" CHECK ("external_transactions"."amount" > 0),
	CONSTRAINT "external_tx_currency_chk" CHECK ("external_transactions"."currency" = 'EGP')
);
--> statement-breakpoint
CREATE TABLE "financial_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"economic_version" text NOT NULL,
	"entry_types" text[] NOT NULL,
	"destination_snapshot" jsonb,
	"reason" text NOT NULL,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"dual_control" boolean DEFAULT false NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"step_up_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_approvals_action_chk" CHECK ("financial_approvals"."action" in ('PAYMENT_CONFIRMATION', 'SELLER_RELEASE', 'REFUND_APPROVAL', 'REFUND_PAYOUT', 'WITHDRAWAL_RESERVATION', 'WITHDRAWAL_RELEASE_RESERVATION', 'WITHDRAWAL_PAYOUT', 'MANUAL_ADJUSTMENT', 'DEAL_PAYMENT_CONFIRMATION', 'DEAL_RELEASE', 'DEAL_REFUND', 'DEAL_PAYOUT')),
	CONSTRAINT "financial_approvals_status_chk" CHECK ("financial_approvals"."status" in ('PENDING_CHECKER', 'APPROVED', 'CONSUMED', 'REVOKED', 'REJECTED')),
	CONSTRAINT "financial_approvals_amount_chk" CHECK ("financial_approvals"."amount" >= 0),
	CONSTRAINT "financial_approvals_currency_chk" CHECK ("financial_approvals"."currency" = 'EGP'),
	CONSTRAINT "financial_approvals_checker_chk" CHECK (not "financial_approvals"."dual_control" or "financial_approvals"."approved_by" is null or "financial_approvals"."approved_by" <> "financial_approvals"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "financial_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"report" jsonb NOT NULL,
	"balanced" boolean NOT NULL,
	"issues" bigint DEFAULT 0 NOT NULL,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body_sha256" text NOT NULL,
	"payload_summary" jsonb,
	"status" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recon_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"file_name" text,
	"row_count" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'IMPORTED' NOT NULL,
	"error" text,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_status_chk";--> statement-breakpoint
ALTER TABLE "inventory_reservations" DROP CONSTRAINT "inv_res_status_chk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_chk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_totals_chk";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_status_chk";--> statement-breakpoint
ALTER TABLE "seller_orders" DROP CONSTRAINT "seller_orders_status_chk";--> statement-breakpoint
ALTER TABLE "seller_orders" DROP CONSTRAINT "seller_orders_fin_chk";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_status_chk";--> statement-breakpoint
ALTER TABLE "external_deals" DROP CONSTRAINT "external_deals_status_chk";--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "buyer_fee_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "seller_fee_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "refunded_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_fee_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "economic_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD COLUMN "proof_sha256" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "principal_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "shipping_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "buyer_fee_refund" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "seller_fee_reversal" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "seller_liability" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "original_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "payout_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "buyer_fee_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "seller_fee_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "shipping_payee" text DEFAULT 'SELLER_FULFILMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "seller_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "ship_by_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "seller_response_overdue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "shipment_overdue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "cancel_reason_code" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_event_source" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_event_ref" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_event_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_report_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "seller_delivery_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "seller_delivery_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_established_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_established_basis" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_established_by" uuid;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "buyer_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "receipt_basis" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "entitled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_exception_code" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "delivery_exception_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "release_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "exception_code" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "exception_note" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "exception_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_payouts" ADD COLUMN "payout_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "buyer_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "receipt_basis" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "entitled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "pending_buyer_refund" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "release_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "reserved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "reserve_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "payout_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "destination_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
-- ── Backfills of NEW columns from existing facts (no financial value is changed) ──
-- Receipt basis of legacy delivered/completed sub-orders, from the recorded confirmation source.
UPDATE "seller_orders" SET "receipt_basis" = CASE "receipt_confirmation_source"
    WHEN 'BUYER' THEN 'BUYER_CONFIRMED' WHEN 'ADMIN_ON_BEHALF' THEN 'LEGACY_ADMIN_ON_BEHALF' ELSE 'LEGACY_PRE_HARDENING' END,
  "entitled_at" = coalesce("delivered_at", "updated_at")
  WHERE "status" IN ('DELIVERED','COMPLETED') AND "receipt_basis" IS NULL;--> statement-breakpoint
-- Legacy withdrawal requests whose funds were already reserved at request time.
UPDATE "withdrawal_requests" w SET "reserved_at" = j."created_at"
  FROM "journal_entries" j WHERE j."idempotency_key" = 'wd:' || w."id" AND w."reserved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_evidence" ADD CONSTRAINT "delivery_evidence_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_evidence" ADD CONSTRAINT "delivery_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_evidence" ADD CONSTRAINT "delivery_evidence_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closure_requests" ADD CONSTRAINT "account_closure_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closure_requests" ADD CONSTRAINT "account_closure_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_transactions" ADD CONSTRAINT "external_transactions_import_id_recon_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."recon_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_transactions" ADD CONSTRAINT "external_transactions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_closes" ADD CONSTRAINT "financial_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_imports" ADD CONSTRAINT "recon_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_requests_open_uq" ON "cancellation_requests" USING btree ("seller_order_id") WHERE "cancellation_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "delivery_evidence_so_idx" ON "delivery_evidence" USING btree ("seller_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_items_uq" ON "refund_items" USING btree ("refund_id","order_item_id");--> statement-breakpoint
CREATE INDEX "closure_user_idx" ON "account_closure_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_tx_ref_uq" ON "external_transactions" USING btree ("channel","direction","external_ref");--> statement-breakpoint
CREATE INDEX "external_tx_state_idx" ON "external_transactions" USING btree ("state","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_approvals_idem_uq" ON "financial_approvals" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "financial_approvals_entity_idx" ON "financial_approvals" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "financial_approvals_status_idx" ON "financial_approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_closes_date_uq" ON "financial_closes" USING btree ("business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_uq" ON "provider_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "provider_events_received_idx" ON "provider_events" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_delivery_event_recorded_by_users_id_fk" FOREIGN KEY ("delivery_event_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_delivery_established_by_users_id_fk" FOREIGN KEY ("delivery_established_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_submissions_reference_idx" ON "payment_submissions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payment_submissions_sha_idx" ON "payment_submissions" USING btree ("proof_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idem_uq" ON "refunds" USING btree ("idempotency_key") WHERE "refunds"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "refunds_so_idx" ON "refunds" USING btree ("seller_order_id");--> statement-breakpoint
CREATE INDEX "seller_orders_buyer_due_idx" ON "seller_orders" USING btree ("buyer_response_due_at") WHERE "seller_orders"."status" = 'AWAITING_BUYER_RESPONSE';--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "journal_entries_approval_idx" ON "journal_entries" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "journal_entries_type_idx" ON "journal_entries" USING btree ("entry_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_chk" CHECK ("users"."status" in ('ACTIVE', 'LOCKED', 'DISABLED', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inv_res_status_chk" CHECK ("inventory_reservations"."status" in ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_refunded_qty_chk" CHECK ("order_items"."refunded_quantity" between 0 and "order_items"."quantity");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_fee_split_chk" CHECK ("order_items"."buyer_fee_amount" >= 0 and "order_items"."seller_fee_amount" >= 0 and "order_items"."buyer_fee_amount" + "order_items"."seller_fee_amount" <= "order_items"."commission_amount");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_chk" CHECK ("orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CLOSED_UNFULFILLED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_chk" CHECK ("orders"."grand_total" = "orders"."merchandise_total" + "orders"."shipping_total" + "orders"."buyer_fee_total" - "orders"."discount_total" and "orders"."grand_total" >= 0 and "orders"."buyer_fee_total" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_components_chk" CHECK ("refunds"."principal_amount" >= 0 and "refunds"."shipping_amount" >= 0 and "refunds"."buyer_fee_refund" >= 0 and "refunds"."seller_fee_reversal" >= 0
      and ("refunds"."principal_amount" + "refunds"."shipping_amount" + "refunds"."buyer_fee_refund" = 0 or "refunds"."principal_amount" + "refunds"."shipping_amount" + "refunds"."buyer_fee_refund" = "refunds"."amount"));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_chk" CHECK ("refunds"."status" in ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED', 'PENDING', 'PAID'));--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_fee_split_chk" CHECK ("seller_orders"."buyer_fee_total" >= 0 and "seller_orders"."seller_fee_total" >= 0 and ("seller_orders"."buyer_fee_total" + "seller_orders"."seller_fee_total" = "seller_orders"."commission_total" or ("seller_orders"."buyer_fee_total" = 0 and "seller_orders"."seller_fee_total" = 0)));--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_receipt_basis_chk" CHECK ("seller_orders"."receipt_basis" in ('BUYER_CONFIRMED', 'TIMEOUT_ENTITLEMENT', 'DISPUTE_DECISION', 'LEGACY_ADMIN_ON_BEHALF', 'LEGACY_PRE_HARDENING'));--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_completion_chk" CHECK ("seller_orders"."status" <> 'COMPLETED' or ("seller_orders"."receipt_basis" is not null and "seller_orders"."funds_released_at" is not null));--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_entitlement_chk" CHECK ("seller_orders"."status" not in ('DELIVERED','COMPLETED') or "seller_orders"."receipt_basis" is not null);--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_status_chk" CHECK ("seller_orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED', 'DELIVERY_FAILED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_fin_chk" CHECK ("seller_orders"."gross_total" = "seller_orders"."merchandise_subtotal" + "seller_orders"."shipping_fee" + "seller_orders"."buyer_fee_total" - "seller_orders"."discount_total"
          and "seller_orders"."seller_net" = "seller_orders"."gross_total" - "seller_orders"."commission_total"
          and "seller_orders"."commission_total" >= 0 and "seller_orders"."refunded_total" >= 0 and "seller_orders"."refunded_total" <= "seller_orders"."gross_total");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_status_chk" CHECK ("shipments"."status" in ('CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'EXCEPTION', 'RETURNED_TO_SELLER', 'LOST'));--> statement-breakpoint
ALTER TABLE "external_deals" ADD CONSTRAINT "external_deals_status_chk" CHECK ("external_deals"."status" in ('DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE', 'COMPLETED', 'DISPUTED', 'REFUND_PENDING', 'CANCELLED', 'REFUNDED'));--> statement-breakpoint
-- ═══════════ Financial approval enforcement (DB level) ═══════════
-- Every journal entry posted from now on must execute a valid, operation-specific Admin approval.
-- The first entry consumes the approval; further entries are accepted only inside the SAME
-- transaction (same now()) and only for the entry types the approval names. A consumed approval
-- from an earlier transaction, a revoked/rejected/pending one, or a missing one is refused.
CREATE OR REPLACE FUNCTION edmn_journal_requires_approval() RETURNS trigger AS $$
DECLARE a record;
BEGIN
  IF NEW.approval_id IS NULL THEN
    RAISE EXCEPTION 'journal entry % (%) has no Admin financial approval', NEW.idempotency_key, NEW.entry_type USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM financial_approvals WHERE id = NEW.approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'financial approval % not found', NEW.approval_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.approved_by IS NULL OR a.approved_at IS NULL THEN
    RAISE EXCEPTION 'financial approval % has no approving Admin', a.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (NEW.entry_type = ANY (a.entry_types)) THEN
    RAISE EXCEPTION 'approval % (%) does not cover entry type %', a.id, a.action, NEW.entry_type USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.status = 'APPROVED' THEN
    UPDATE financial_approvals SET status = 'CONSUMED', consumed_at = now() WHERE id = a.id;
  ELSIF NOT (a.status = 'CONSUMED' AND a.consumed_at = now()) THEN
    RAISE EXCEPTION 'financial approval % is % and cannot be (re)used', a.id, a.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER journal_entries_require_approval BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION edmn_journal_requires_approval();--> statement-breakpoint
-- At commit: the debits posted under one approval must equal exactly the approved amount.
CREATE OR REPLACE FUNCTION edmn_journal_approval_amount() RETURNS trigger AS $$
DECLARE approved bigint; posted bigint;
BEGIN
  IF NEW.approval_id IS NULL THEN RETURN NULL; END IF;
  SELECT amount INTO approved FROM financial_approvals WHERE id = NEW.approval_id;
  SELECT coalesce(sum(l.debit), 0) INTO posted FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.approval_id = NEW.approval_id;
  IF posted <> approved THEN
    RAISE EXCEPTION 'approval % covers % but % was posted', NEW.approval_id, approved, posted USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_approval_amount AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edmn_journal_approval_amount();--> statement-breakpoint
-- Approvals are evidence: never deleted; only their status may move forward (and only once consumed/revoked).
CREATE OR REPLACE FUNCTION edmn_financial_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial approvals are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.action <> OLD.action OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id OR NEW.amount <> OLD.amount
     OR NEW.currency <> OLD.currency OR NEW.economic_version <> OLD.economic_version OR NEW.entry_types <> OLD.entry_types
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot OR NEW.dual_control <> OLD.dual_control THEN
    RAISE EXCEPTION 'financial approval % is immutable (a new approval is required)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('CONSUMED','REVOKED','REJECTED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'financial approval % is final (%)', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'approver of % cannot be rewritten', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER financial_approvals_guard BEFORE UPDATE OR DELETE ON financial_approvals
  FOR EACH ROW EXECUTE FUNCTION edmn_financial_approval_guard();--> statement-breakpoint
CREATE TRIGGER financial_approvals_no_truncate BEFORE TRUNCATE ON financial_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- Status history, refund items and delivery evidence are append-only evidence.
CREATE TRIGGER refund_items_append_only BEFORE UPDATE OR DELETE ON refund_items
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_evidence_append_only BEFORE UPDATE OR DELETE ON delivery_evidence
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER provider_events_append_only BEFORE UPDATE OR DELETE ON provider_events
  FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- The buyer's response deadline and the seller's delivery-report deadline, once set, are never moved
-- (retries, evidence edits or resent notices cannot restart or shorten the clock).
CREATE OR REPLACE FUNCTION edmn_seller_order_deadline_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.buyer_response_due_at IS NOT NULL AND NEW.buyer_response_due_at IS DISTINCT FROM OLD.buyer_response_due_at THEN
    RAISE EXCEPTION 'buyer response deadline of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.delivery_report_due_at IS NOT NULL AND NEW.delivery_report_due_at IS DISTINCT FROM OLD.delivery_report_due_at THEN
    RAISE EXCEPTION 'delivery report deadline of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.receipt_basis IS NOT NULL AND NEW.receipt_basis IS DISTINCT FROM OLD.receipt_basis THEN
    RAISE EXCEPTION 'receipt basis of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.funds_released_at IS NOT NULL AND NEW.funds_released_at IS DISTINCT FROM OLD.funds_released_at THEN
    RAISE EXCEPTION 'release of % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER seller_orders_deadline_guard BEFORE UPDATE ON seller_orders
  FOR EACH ROW EXECUTE FUNCTION edmn_seller_order_deadline_guard();--> statement-breakpoint
-- Withdrawal destination snapshot is frozen once set.
CREATE OR REPLACE FUNCTION edmn_withdrawal_destination_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.destination_snapshot IS NOT NULL AND NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot THEN
    RAISE EXCEPTION 'withdrawal % destination snapshot is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.amount <> NEW.amount THEN
    RAISE EXCEPTION 'withdrawal % amount is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_destination_guard BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION edmn_withdrawal_destination_guard();--> statement-breakpoint
-- Ledger, approvals, refunds, withdrawals, orders and evidence are never deleted.
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER withdrawal_requests_no_delete BEFORE DELETE ON withdrawal_requests FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER seller_orders_no_delete BEFORE DELETE ON seller_orders FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER ledger_accounts_no_delete BEFORE DELETE ON ledger_accounts FOR EACH ROW EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
CREATE TRIGGER status_history_no_truncate BEFORE TRUNCATE ON status_history FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();--> statement-breakpoint
-- One-time grant of the new staff permissions to the existing default roles (editable afterwards).
INSERT INTO role_permissions (role_code, permission)
SELECT r.code, p.permission FROM roles r
JOIN (VALUES
  ('SUPER_ADMIN','finance.release'), ('SUPER_ADMIN','refunds.approve'), ('SUPER_ADMIN','finance.controls'),
  ('SUPER_ADMIN','reconciliation.manage'), ('SUPER_ADMIN','delivery.verify'),
  ('FINANCE_CHECKER','finance.release'), ('FINANCE_CHECKER','refunds.approve'), ('FINANCE_CHECKER','finance.controls'),
  ('FINANCE_CHECKER','reconciliation.manage'), ('FINANCE_OPERATOR','reconciliation.manage'),
  ('OPERATIONS_MANAGER','delivery.verify'), ('DISPUTE_OFFICER','delivery.verify')
) AS p(role_code, permission) ON p.role_code = r.code
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Fee split carried over from the existing configuration: the EDMN fee has always been charged to the
-- seller (buyer share 0%). Recorded as NOT owner-approved; real-money activation stays blocked until the
-- owner approves a fee configuration explicitly. Existing values (if any) are never overwritten.
INSERT INTO system_settings (key, value) VALUES ('fees.buyerShareBps', '0'::jsonb), ('fees.ownerApproved', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
