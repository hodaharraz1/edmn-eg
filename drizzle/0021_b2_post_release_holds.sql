CREATE TABLE "seller_financial_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"dispute_id" uuid,
	"return_id" uuid,
	"refund_id" uuid,
	"amount" bigint NOT NULL,
	"secured_at_open" bigint NOT NULL,
	"unsecured_at_open" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_reason" text,
	CONSTRAINT "seller_holds_kind_chk" CHECK ("seller_financial_holds"."kind" in ('DISPUTE', 'RETURN', 'REFUND')),
	CONSTRAINT "seller_holds_status_chk" CHECK ("seller_financial_holds"."status" in ('ACTIVE', 'RELEASED', 'CONVERTED', 'CONSUMED')),
	CONSTRAINT "seller_holds_amount_chk" CHECK ("seller_financial_holds"."amount" > 0 and "seller_financial_holds"."secured_at_open" >= 0 and "seller_financial_holds"."unsecured_at_open" >= 0 and "seller_financial_holds"."secured_at_open" + "seller_financial_holds"."unsecured_at_open" = "seller_financial_holds"."amount"),
	CONSTRAINT "seller_holds_closed_chk" CHECK (("seller_financial_holds"."status" = 'ACTIVE') = ("seller_financial_holds"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_financial_holds" ADD CONSTRAINT "seller_financial_holds_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_holds_active_source_uq" ON "seller_financial_holds" USING btree ("kind","source_id") WHERE "seller_financial_holds"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "seller_holds_seller_active_idx" ON "seller_financial_holds" USING btree ("seller_id") WHERE "seller_financial_holds"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "seller_holds_seller_order_idx" ON "seller_financial_holds" USING btree ("seller_order_id");--> statement-breakpoint
-- B2: holds are evidence of a financial restriction. Never deleted; amount / source / seller / snapshot are
-- immutable; the only change is ACTIVE → RELEASED | CONVERTED | CONSUMED (with who/when/why).
CREATE OR REPLACE FUNCTION edmn_seller_hold_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'seller financial holds cannot be deleted'; END IF;
  IF NEW.seller_id <> OLD.seller_id OR NEW.seller_order_id <> OLD.seller_order_id OR NEW.kind <> OLD.kind OR NEW.source_id <> OLD.source_id
     OR NEW.dispute_id IS DISTINCT FROM OLD.dispute_id OR NEW.return_id IS DISTINCT FROM OLD.return_id OR NEW.refund_id IS DISTINCT FROM OLD.refund_id
     OR NEW.amount <> OLD.amount OR NEW.secured_at_open <> OLD.secured_at_open OR NEW.unsecured_at_open <> OLD.unsecured_at_open
     OR NEW.reason <> OLD.reason OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'seller financial hold content is immutable';
  END IF;
  IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'a closed seller financial hold cannot change'; END IF;
  IF NEW.status NOT IN ('RELEASED', 'CONVERTED', 'CONSUMED') THEN RAISE EXCEPTION 'invalid seller financial hold transition % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER seller_financial_holds_guard BEFORE UPDATE OR DELETE ON seller_financial_holds FOR EACH ROW EXECUTE FUNCTION edmn_seller_hold_guard();
--> statement-breakpoint
CREATE TRIGGER seller_financial_holds_no_truncate BEFORE TRUNCATE ON seller_financial_holds FOR EACH STATEMENT EXECUTE FUNCTION edmn_forbid_mutation();
