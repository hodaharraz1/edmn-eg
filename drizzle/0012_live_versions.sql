CREATE TABLE "live_versions" (
	"key" text PRIMARY KEY NOT NULL,
	"version" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Live-channel change tokens, maintained only by triggers (additive; touches no existing rows).
CREATE SEQUENCE IF NOT EXISTS "live_version_seq";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_bump(keys text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO live_versions (key, version, updated_at)
  SELECT u.k, nextval('live_version_seq'), now() FROM (SELECT DISTINCT k FROM unnest(keys) AS k WHERE k IS NOT NULL) AS u
  ON CONFLICT (key) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_conv_keys(conv uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY['user:' || c.buyer_user_id::text,
               CASE WHEN c.seller_id IS NOT NULL THEN 'seller:' || c.seller_id::text END,
               CASE WHEN c.seller_user_id IS NOT NULL THEN 'user:' || c.seller_user_id::text END]
  FROM conversations c WHERE c.id = conv
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_on_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM edmn_live_bump(edmn_live_conv_keys(NEW.conversation_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversation_messages_live AFTER INSERT OR UPDATE OF hidden_at ON conversation_messages FOR EACH ROW EXECUTE FUNCTION edmn_live_on_message();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_on_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- the reader's own counts, and the other side's read receipts
  PERFORM edmn_live_bump(edmn_live_conv_keys(NEW.conversation_id) || ARRAY['user:' || NEW.user_id::text]);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversation_reads_live AFTER INSERT OR UPDATE ON conversation_reads FOR EACH ROW EXECUTE FUNCTION edmn_live_on_read();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_on_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM edmn_live_bump(edmn_live_conv_keys(NEW.id));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversations_live AFTER INSERT OR UPDATE OF status ON conversations FOR EACH ROW EXECUTE FUNCTION edmn_live_on_conversation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_live_on_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM edmn_live_bump(ARRAY['user:' || NEW.user_id::text]);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER notifications_live AFTER INSERT OR UPDATE OF read_at ON notifications FOR EACH ROW EXECUTE FUNCTION edmn_live_on_notification();
