CREATE TABLE "deal_terms_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"proposed_by" text NOT NULL,
	"proposed_by_user_id" uuid NOT NULL,
	"terms" jsonb NOT NULL,
	"message" text,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_terms_versions_status_chk" CHECK ("deal_terms_versions"."status" in ('PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "deal_terms_versions_by_chk" CHECK ("deal_terms_versions"."proposed_by" in ('SELLER','BUYER'))
);
--> statement-breakpoint
ALTER TABLE "external_deals" DROP CONSTRAINT "external_deals_status_chk";--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "location_enc" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "return_condition_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "return_shipping_payer" text DEFAULT 'BY_REASON' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "return_condition_keys" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "return_shipping_payer" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "return_policy_notes" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "return_policy_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "return_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD COLUMN "bound_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD COLUMN "bound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_full_name" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_verified_phone" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_contact_email" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "buyer_location_enc" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "seller_location_enc" text;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "origin_governorate_id" integer;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "destination_governorate_id" integer;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "shipping_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "processing_days" integer;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "agreed_terms" jsonb;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "agreed_version" integer;--> statement-breakpoint
ALTER TABLE "external_deals" ADD COLUMN "agreed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_terms_versions" ADD CONSTRAINT "deal_terms_versions_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_terms_versions" ADD CONSTRAINT "deal_terms_versions_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_terms_versions_uq" ON "deal_terms_versions" USING btree ("deal_id","version");--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD CONSTRAINT "deal_invitations_bound_user_id_users_id_fk" FOREIGN KEY ("bound_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_deals" ADD CONSTRAINT "external_deals_status_chk" CHECK ("external_deals"."status" in ('DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'BUYER_CONFIRMATION_PENDING', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'));--> statement-breakpoint
-- Agreed deal terms are a binding snapshot: once set they can never be changed or cleared.
CREATE OR REPLACE FUNCTION edmn_agreed_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.agreed_terms IS NOT NULL AND (NEW.agreed_terms IS DISTINCT FROM OLD.agreed_terms OR NEW.agreed_version IS DISTINCT FROM OLD.agreed_version) THEN
    RAISE EXCEPTION 'agreed deal terms are immutable (deal %)', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER external_deals_agreed_terms_immutable BEFORE UPDATE ON external_deals FOR EACH ROW EXECUTE FUNCTION edmn_agreed_terms_immutable();
--> statement-breakpoint
-- Terms versions are history: no deletes, and the terms of a version never change.
CREATE OR REPLACE FUNCTION edmn_terms_versions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'deal terms versions are append-only'; END IF;
  IF NEW.terms IS DISTINCT FROM OLD.terms OR NEW.version IS DISTINCT FROM OLD.version OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    RAISE EXCEPTION 'deal terms version content is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deal_terms_versions_append_only BEFORE UPDATE OR DELETE ON deal_terms_versions FOR EACH ROW EXECUTE FUNCTION edmn_terms_versions_append_only();
--> statement-breakpoint
-- Existing listings were created under the store-level policy, which counts as an explicit choice.
UPDATE products SET return_policy_confirmed = true WHERE return_policy_confirmed = false;
