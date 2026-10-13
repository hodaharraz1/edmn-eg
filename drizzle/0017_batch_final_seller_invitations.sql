CREATE TABLE "seller_member_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"invited_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_member_invitations_status_chk" CHECK ("seller_member_invitations"."status" in ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED')),
	CONSTRAINT "seller_member_invitations_role_chk" CHECK ("seller_member_invitations"."role" in ('STORE_OWNER', 'STORE_MANAGER', 'CATALOG_MANAGER', 'ORDER_MANAGER', 'FINANCE', 'SUPPORT'))
);
--> statement-breakpoint
ALTER TABLE "seller_member_invitations" ADD CONSTRAINT "seller_member_invitations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_member_invitations" ADD CONSTRAINT "seller_member_invitations_invited_user_id_users_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_member_invitations" ADD CONSTRAINT "seller_member_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_member_invitations" ADD CONSTRAINT "seller_member_invitations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_member_invitations_open_uq" ON "seller_member_invitations" USING btree ("seller_id","invited_user_id") WHERE "seller_member_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "seller_member_invitations_user_idx" ON "seller_member_invitations" USING btree ("invited_user_id","status");