CREATE TABLE "conversation_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_reports_reason_chk" CHECK ("conversation_message_reports"."reason" in ('INAPPROPRIATE', 'FRAUD_ATTEMPT', 'UNNEEDED_DATA_REQUEST', 'OTHER')),
	CONSTRAINT "conversation_message_reports_status_chk" CHECK ("conversation_message_reports"."status" in ('OPEN', 'ACTIONED', 'DISMISSED'))
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_role" text NOT NULL,
	"body" text NOT NULL,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	CONSTRAINT "conversation_messages_role_chk" CHECK ("conversation_messages"."sender_role" in ('BUYER', 'SELLER')),
	CONSTRAINT "conversation_messages_body_chk" CHECK (char_length("conversation_messages"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context" text NOT NULL,
	"order_id" uuid,
	"seller_order_id" uuid,
	"deal_id" uuid,
	"buyer_user_id" uuid NOT NULL,
	"seller_id" uuid,
	"seller_user_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"locked_reason" text,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_context_chk" CHECK ("conversations"."context" in ('SELLER_ORDER', 'DEAL')),
	CONSTRAINT "conversations_status_chk" CHECK ("conversations"."status" in ('ACTIVE', 'LOCKED')),
	CONSTRAINT "conversations_binding_chk" CHECK (("conversations"."context" = 'SELLER_ORDER' and "conversations"."seller_order_id" is not null and "conversations"."order_id" is not null and "conversations"."seller_id" is not null and "conversations"."deal_id" is null and "conversations"."seller_user_id" is null)
       or ("conversations"."context" = 'DEAL' and "conversations"."deal_id" is not null and "conversations"."seller_user_id" is not null and "conversations"."seller_order_id" is null and "conversations"."order_id" is null and "conversations"."seller_id" is null))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_chk";--> statement-breakpoint
ALTER TABLE "conversation_message_attachments" ADD CONSTRAINT "conversation_message_attachments_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_attachments" ADD CONSTRAINT "conversation_message_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_reports" ADD CONSTRAINT "conversation_message_reports_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_reports" ADD CONSTRAINT "conversation_message_reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_reports" ADD CONSTRAINT "conversation_message_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_reports" ADD CONSTRAINT "conversation_message_reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_attachments_file_uq" ON "conversation_message_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "conversation_message_attachments_msg_idx" ON "conversation_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_reports_uq" ON "conversation_message_reports" USING btree ("message_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "conversation_message_reports_status_idx" ON "conversation_message_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_conv_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_client_uq" ON "conversation_messages" USING btree ("sender_user_id","client_key");--> statement-breakpoint
CREATE INDEX "conversation_reads_user_idx" ON "conversation_reads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_so_uq" ON "conversations" USING btree ("seller_order_id") WHERE "conversations"."seller_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_deal_uq" ON "conversations" USING btree ("deal_id") WHERE "conversations"."deal_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_buyer_idx" ON "conversations" USING btree ("buyer_user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_seller_idx" ON "conversations" USING btree ("seller_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_seller_user_idx" ON "conversations" USING btree ("seller_user_id","last_message_at");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_chk" CHECK ("files"."purpose" in ('PRODUCT_IMAGE', 'STORE_LOGO', 'STORE_BANNER', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'CMS_IMAGE', 'REVIEW_PHOTO', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'SHIPPING_WAYBILL', 'RETURN_EVIDENCE', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'SUPPORT_ATTACHMENT', 'MESSAGE_ATTACHMENT'));--> statement-breakpoint
-- Messages are evidence: never deleted, never edited. The only permitted change is a one-time
-- staff moderation flag (hidden_at/by/reason); the original body is always preserved.
CREATE OR REPLACE FUNCTION edmn_conversation_message_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'conversation messages are append-only'; END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR NEW.sender_role IS DISTINCT FROM OLD.sender_role OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.client_key IS DISTINCT FROM OLD.client_key THEN
    RAISE EXCEPTION 'conversation messages are immutable';
  END IF;
  IF OLD.hidden_at IS NOT NULL AND (NEW.hidden_at IS DISTINCT FROM OLD.hidden_at OR NEW.hidden_by IS DISTINCT FROM OLD.hidden_by OR NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason) THEN
    RAISE EXCEPTION 'message moderation is recorded once';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_messages_guard BEFORE UPDATE OR DELETE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION edmn_conversation_message_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_message_attachments_guard BEFORE UPDATE OR DELETE ON conversation_message_attachments FOR EACH ROW EXECUTE FUNCTION edmn_append_only_guard();
--> statement-breakpoint
-- A conversation's business binding (who and which order/deal) can never be re-pointed or deleted.
CREATE OR REPLACE FUNCTION edmn_conversation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'conversations are never deleted'; END IF;
  IF NEW.context IS DISTINCT FROM OLD.context OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.seller_order_id IS DISTINCT FROM OLD.seller_order_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'conversation binding is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversations_guard BEFORE UPDATE OR DELETE ON conversations FOR EACH ROW EXECUTE FUNCTION edmn_conversation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_no_delete_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_message_reports_guard BEFORE DELETE ON conversation_message_reports FOR EACH ROW EXECUTE FUNCTION edmn_no_delete_guard();
--> statement-breakpoint
-- One-time grant of the new staff permissions to the existing default roles (roles edited later by a
-- SUPER_ADMIN are respected: this runs once, with the migration). Finance/catalog/payment roles get none.
INSERT INTO role_permissions (role_code, permission)
SELECT r.code, p.permission FROM roles r
JOIN (VALUES ('SUPER_ADMIN','messages.view'), ('SUPER_ADMIN','messages.moderate'),
             ('OPERATIONS_MANAGER','messages.view'), ('OPERATIONS_MANAGER','messages.moderate'),
             ('DISPUTE_OFFICER','messages.view'),
             ('CUSTOMER_SUPPORT','messages.view'), ('CUSTOMER_SUPPORT','messages.moderate')) AS p(role_code, permission)
  ON p.role_code = r.code
ON CONFLICT DO NOTHING;
