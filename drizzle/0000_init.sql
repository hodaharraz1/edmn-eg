CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SEQUENCE "public"."doc_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 500001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"governorate_id" integer NOT NULL,
	"city" text NOT NULL,
	"district" text,
	"street" text NOT NULL,
	"building" text,
	"floor" text,
	"apartment" text,
	"landmark" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_purpose_chk" CHECK ("auth_tokens"."purpose" in ('PASSWORD_RESET', 'EMAIL_VERIFY', 'PHONE_VERIFY'))
);
--> statement-breakpoint
CREATE TABLE "governorates" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "governorates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_code" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_code_permission_pk" PRIMARY KEY("role_code","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"step_up_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_scope_chk" CHECK ("sessions"."scope" in ('WEB', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_pk" PRIMARY KEY("user_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"phone" text,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_chk" CHECK ("users"."status" in ('ACTIVE', 'LOCKED', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visibility" text NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"variant_keys" text[],
	"original_name" text,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_visibility_chk" CHECK ("files"."visibility" in ('PUBLIC', 'PRIVATE')),
	CONSTRAINT "files_purpose_chk" CHECK ("files"."purpose" in ('PRODUCT_IMAGE', 'STORE_LOGO', 'STORE_BANNER', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'CMS_IMAGE', 'REVIEW_PHOTO', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'SHIPPING_WAYBILL', 'RETURN_EVIDENCE', 'DISPUTE_EVIDENCE', 'DEAL_EVIDENCE', 'WITHDRAWAL_PROOF', 'REFUND_PROOF', 'SUPPORT_ATTACHMENT'))
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"code" text NOT NULL,
	"severity" text DEFAULT 'MEDIUM' NOT NULL,
	"note" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"meta" jsonb,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "seller_documents_kind_chk" CHECK ("seller_documents"."kind" in ('NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'COMMERCIAL_REGISTRATION', 'TAX_CARD', 'AUTHORIZATION_LETTER', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "seller_members" (
	"seller_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_members_seller_id_user_id_pk" PRIMARY KEY("seller_id","user_id"),
	CONSTRAINT "seller_members_role_chk" CHECK ("seller_members"."role" in ('STORE_OWNER', 'STORE_MANAGER', 'CATALOG_MANAGER', 'ORDER_MANAGER', 'FINANCE', 'SUPPORT'))
);
--> statement-breakpoint
CREATE TABLE "seller_payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"type" text NOT NULL,
	"details_enc" text NOT NULL,
	"masked_label" text NOT NULL,
	"holder_name" text NOT NULL,
	"status" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_payout_methods_type_chk" CHECK ("seller_payout_methods"."type" in ('BANK_ACCOUNT', 'INSTAPAY', 'MOBILE_WALLET')),
	CONSTRAINT "seller_payout_methods_status_chk" CHECK ("seller_payout_methods"."status" in ('ACTIVE', 'PENDING_VERIFICATION', 'REJECTED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "seller_shipping_rates" (
	"seller_id" uuid NOT NULL,
	"governorate_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fee" bigint NOT NULL,
	"eta_min_days" integer NOT NULL,
	"eta_max_days" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_shipping_rates_seller_id_governorate_id_pk" PRIMARY KEY("seller_id","governorate_id"),
	CONSTRAINT "ssr_fee_chk" CHECK ("seller_shipping_rates"."fee" >= 0),
	CONSTRAINT "ssr_eta_chk" CHECK ("seller_shipping_rates"."eta_min_days" >= 0 and "seller_shipping_rates"."eta_max_days" >= "seller_shipping_rates"."eta_min_days" and "seller_shipping_rates"."eta_max_days" <= 60)
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"status_reason" text,
	"legal_name" text,
	"national_id_enc" text,
	"national_id_last4" text,
	"mobile" text,
	"mobile_verified_at" timestamp with time zone,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"address_line" text,
	"city" text,
	"governorate_id" integer,
	"business_legal_name" text,
	"commercial_registration_no" text,
	"tax_registration_no" text,
	"business_address" text,
	"authorized_representative" text,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"agreement_version" text,
	"agreement_accepted_at" timestamp with time zone,
	"payout_hold_until" timestamp with time zone,
	"auto_settlement" boolean DEFAULT true NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"positive_count" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'NORMAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_status_chk" CHECK ("sellers"."status" in ('DRAFT', 'PENDING_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'RESTRICTED', 'SUSPENDED', 'REJECTED')),
	CONSTRAINT "sellers_type_chk" CHECK ("sellers"."type" in ('INDIVIDUAL', 'BUSINESS'))
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"logo_file_id" uuid,
	"banner_file_id" uuid,
	"return_address" text,
	"return_governorate_id" integer,
	"support_phone" text,
	"accepts_voluntary_returns" boolean DEFAULT false NOT NULL,
	"voluntary_return_days" integer,
	"return_conditions" text,
	"shipping_policy" text,
	"default_processing_days" integer DEFAULT 2 NOT NULL,
	"free_shipping_threshold" bigint,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_return_days_chk" CHECK ("stores"."voluntary_return_days" is null or "stores"."voluntary_return_days" between 1 and 365),
	CONSTRAINT "stores_processing_chk" CHECK ("stores"."default_processing_days" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "attribute_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value" text NOT NULL,
	"label_ar" text NOT NULL,
	"label_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"type" text NOT NULL,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attributes_type_chk" CHECK ("attributes"."type" in ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN'))
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"logo_file_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"image_file_id" uuid,
	"icon" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"is_prohibited" boolean DEFAULT false NOT NULL,
	"path" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_attributes" (
	"category_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_variant_axis" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_attributes_category_id_attribute_id_pk" PRIMARY KEY("category_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"delta_on_hand" integer DEFAULT 0 NOT NULL,
	"delta_reserved" integer DEFAULT 0 NOT NULL,
	"reference" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "inv_res_qty_chk" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inv_res_status_chk" CHECK ("inventory_reservations"."status" in ('ACTIVE', 'COMMITTED', 'RELEASED'))
);
--> statement-breakpoint
CREATE TABLE "listing_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"reason_code" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_policy_rules_kind_chk" CHECK ("listing_policy_rules"."kind" in ('BLOCK_KEYWORD', 'REVIEW_KEYWORD'))
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"values" text[] NOT NULL,
	CONSTRAINT "product_attribute_values_product_id_attribute_id_pk" PRIMARY KEY("product_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"alt" text,
	"is_actual_item" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"revision_id" uuid,
	"action" text NOT NULL,
	"reason_code" text,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"data" jsonb NOT NULL,
	"changed_fields" text[] NOT NULL,
	"reason" text,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_revisions_status_chk" CHECK ("product_revisions"."status" in ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"stock_on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_price_chk" CHECK ("product_variants"."price" > 0),
	CONSTRAINT "variants_compare_chk" CHECK ("product_variants"."compare_at_price" is null or "product_variants"."compare_at_price" > "product_variants"."price"),
	CONSTRAINT "variants_stock_chk" CHECK ("product_variants"."stock_on_hand" >= 0 and "product_variants"."reserved" >= 0 and "product_variants"."reserved" <= "product_variants"."stock_on_hand")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"status_reason" text,
	"slug" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text,
	"description" text,
	"key_features" text[] DEFAULT '{}'::text[] NOT NULL,
	"condition" text DEFAULT 'NEW' NOT NULL,
	"used_grade" text,
	"condition_notes" text,
	"defects" text,
	"included_accessories" text,
	"usage_info" text,
	"warranty_info" text,
	"weight_grams" integer,
	"length_cm" integer,
	"width_cm" integer,
	"height_cm" integer,
	"processing_days" integer,
	"return_policy_override" boolean DEFAULT false NOT NULL,
	"accepts_voluntary_returns" boolean,
	"voluntary_return_days" integer,
	"seo_title" text,
	"seo_description" text,
	"min_price" bigint,
	"max_compare_at_price" bigint,
	"total_available" integer DEFAULT 0 NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED,
	"needs_enhanced_review" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_status_chk" CHECK ("products"."status" in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'LIVE', 'REJECTED', 'SUSPENDED', 'ARCHIVED')),
	CONSTRAINT "products_condition_chk" CHECK ("products"."condition" in ('NEW', 'USED')),
	CONSTRAINT "products_used_grade_chk" CHECK ("products"."condition" <> 'USED' or "products"."status" in ('DRAFT') or "products"."used_grade" is not null)
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price_seen" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_qty_chk" CHECK ("cart_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"label" text NOT NULL,
	"percent_bps" integer NOT NULL,
	"min_fee" bigint,
	"tiers" jsonb,
	"effective_from" timestamp with time zone NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_bps_chk" CHECK ("commission_rules"."percent_bps" between 0 and 10000),
	CONSTRAINT "commission_rules_min_chk" CHECK ("commission_rules"."min_fee" is null or "commission_rules"."min_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"title_snapshot" text NOT NULL,
	"variant_label" text DEFAULT '' NOT NULL,
	"sku_snapshot" text NOT NULL,
	"condition_snapshot" text NOT NULL,
	"image_file_id" uuid,
	"category_id_snapshot" uuid,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" bigint NOT NULL,
	"commission_rule_id" uuid,
	"commission_bps" integer NOT NULL,
	"commission_amount" bigint NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_qty_chk" CHECK ("order_items"."quantity" > 0 and "order_items"."returned_quantity" between 0 and "order_items"."quantity"),
	CONSTRAINT "order_items_total_chk" CHECK ("order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('order_number_seq') NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"governorate_id" integer NOT NULL,
	"merchandise_total" bigint NOT NULL,
	"shipping_total" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"payment_due_at" timestamp with time zone NOT NULL,
	"checkout_key" text NOT NULL,
	"customer_note" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_chk" CHECK ("orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_totals_chk" CHECK ("orders"."grand_total" = "orders"."merchandise_total" + "orders"."shipping_total" - "orders"."discount_total" and "orders"."grand_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_code" text NOT NULL,
	"label" text NOT NULL,
	"details" jsonb NOT NULL,
	"instructions_ar" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"instructions_ar" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"proof_file_id" uuid NOT NULL,
	"reference" text,
	"claimed_amount" bigint NOT NULL,
	"payer_name" text,
	"notes" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_submissions_status_chk" CHECK ("payment_submissions"."status" in ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'NEW_PROOF_REQUESTED', 'SUPERSEDED'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"deal_id" uuid,
	"payer_user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"destination_id" uuid,
	"destination_snapshot" jsonb,
	"amount_due" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"provider" text DEFAULT 'MANUAL' NOT NULL,
	"provider_reference" text,
	"due_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_chk" CHECK ("payments"."status" in ('AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "payments_target_chk" CHECK (("payments"."order_id" is null) <> ("payments"."deal_id" is null)),
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount_due" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"seller_order_id" uuid,
	"deal_id" uuid,
	"amount" bigint NOT NULL,
	"commission_reversal" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"customer_destination" text,
	"paid_reference" text,
	"paid_proof_file_id" uuid,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_chk" CHECK ("refunds"."status" in ('PENDING', 'PAID', 'CANCELLED')),
	CONSTRAINT "refunds_amount_chk" CHECK ("refunds"."amount" > 0 and "refunds"."commission_reversal" >= 0 and "refunds"."commission_reversal" <= "refunds"."amount")
);
--> statement-breakpoint
CREATE TABLE "seller_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"suffix" text NOT NULL,
	"status" text NOT NULL,
	"merchandise_subtotal" bigint NOT NULL,
	"shipping_fee" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"gross_total" bigint NOT NULL,
	"commission_basis" bigint NOT NULL,
	"commission_total" bigint NOT NULL,
	"adjustments_total" bigint DEFAULT 0 NOT NULL,
	"refunded_total" bigint DEFAULT 0 NOT NULL,
	"seller_net" bigint NOT NULL,
	"shipping_eta_min_days" integer,
	"shipping_eta_max_days" integer,
	"processing_days" integer,
	"paid_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"receipt_confirmed_by" uuid,
	"receipt_confirmation_source" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"financial_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"funds_released_at" timestamp with time zone,
	"delivery_follow_up_flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_orders_status_chk" CHECK ("seller_orders"."status" in ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "seller_orders_fin_chk" CHECK ("seller_orders"."gross_total" = "seller_orders"."merchandise_subtotal" + "seller_orders"."shipping_fee" - "seller_orders"."discount_total"
          and "seller_orders"."seller_net" = "seller_orders"."gross_total" - "seller_orders"."commission_total"
          and "seller_orders"."commission_total" >= 0 and "seller_orders"."refunded_total" >= 0 and "seller_orders"."refunded_total" <= "seller_orders"."gross_total")
);
--> statement-breakpoint
CREATE TABLE "shipment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text DEFAULT 'WAYBILL' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"carrier_name" text NOT NULL,
	"tracking_number" text,
	"shipped_at" timestamp with time zone,
	"expected_delivery_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_status_chk" CHECK ("shipments"."status" in ('CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by" uuid,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_invitations_status_chk" CHECK ("deal_invitations"."status" in ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "deal_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"payee_user_id" uuid,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"paid_reference" text,
	"paid_proof_file_id" uuid,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_payouts_status_chk" CHECK ("deal_payouts"."status" in ('PENDING', 'PAID')),
	CONSTRAINT "deal_payouts_amount_chk" CHECK ("deal_payouts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "external_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"buyer_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"wizard_step" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"product_category" text,
	"condition" text,
	"source_url" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"seller_name" text,
	"seller_phone" text,
	"seller_email" text,
	"seller_user_id" uuid,
	"unit_price" bigint,
	"total_amount" bigint,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"fee_payer" text DEFAULT 'SELLER' NOT NULL,
	"buyer_pays" bigint,
	"seller_receives" bigint,
	"delivery_method" text,
	"delivery_deadline" timestamp with time zone,
	"inspection_days" integer DEFAULT 2 NOT NULL,
	"custom_terms" text,
	"terms_version" text,
	"seller_payout_type" text,
	"seller_payout_enc" text,
	"seller_payout_masked" text,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_note" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_deals_status_chk" CHECK ("external_deals"."status" in ('DRAFT', 'INVITED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'BUYER_CONFIRMATION_PENDING', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED')),
	CONSTRAINT "external_deals_qty_chk" CHECK ("external_deals"."quantity" between 1 and 10000),
	CONSTRAINT "external_deals_amount_chk" CHECK ("external_deals"."total_amount" is null or "external_deals"."total_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"seller_order_id" uuid,
	"deal_id" uuid,
	"return_id" uuid,
	"claimant_user_id" uuid NOT NULL,
	"respondent_seller_id" uuid,
	"respondent_user_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reason_code" text NOT NULL,
	"description" text NOT NULL,
	"claimed_amount" bigint,
	"assigned_to" uuid,
	"decision" text,
	"decision_amount" bigint,
	"decision_reason_code" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_status_chk" CHECK ("disputes"."status" in ('OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "disputes_subject_chk" CHECK (("disputes"."seller_order_id" is null) <> ("disputes"."deal_id" is null))
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"photo_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'PUBLISHED' NOT NULL,
	"moderation_reason" text,
	"seller_response" text,
	"seller_responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_reviews_rating_chk" CHECK ("product_reviews"."rating" between 1 and 5),
	CONSTRAINT "product_reviews_status_chk" CHECK ("product_reviews"."status" in ('PUBLISHED', 'HIDDEN', 'REMOVED'))
);
--> statement-breakpoint
CREATE TABLE "return_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "return_items_qty_chk" CHECK ("return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"decision_reason" text,
	"return_carrier" text,
	"return_tracking" text,
	"inspection_note" text,
	"refund_amount" bigint,
	"include_shipping" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_status_chk" CHECK ("returns"."status" in ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'INSPECTION', 'REFUND_PENDING', 'REFUNDED', 'REJECTED', 'DISPUTED')),
	CONSTRAINT "returns_reason_chk" CHECK ("returns"."reason" in ('CHANGED_MIND', 'WRONG_ITEM', 'DAMAGED', 'DEFECTIVE', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_type" text NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"delivery_rating" integer,
	"packaging_rating" integer,
	"accuracy_rating" integer,
	"communication_rating" integer,
	"body" text,
	"status" text DEFAULT 'PUBLISHED' NOT NULL,
	"moderation_reason" text,
	"seller_response" text,
	"seller_responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_reviews_rating_chk" CHECK ("seller_reviews"."rating" between 1 and 5
        and ("seller_reviews"."delivery_rating" is null or "seller_reviews"."delivery_rating" between 1 and 5)
        and ("seller_reviews"."packaging_rating" is null or "seller_reviews"."packaging_rating" between 1 and 5)
        and ("seller_reviews"."accuracy_rating" is null or "seller_reviews"."accuracy_rating" between 1 and 5)
        and ("seller_reviews"."communication_rating" is null or "seller_reviews"."communication_rating" between 1 and 5)),
	CONSTRAINT "seller_reviews_status_chk" CHECK ("seller_reviews"."status" in ('PUBLISHED', 'HIDDEN', 'REMOVED'))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"entry_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"reverses_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_amount_chk" CHECK ("journal_lines"."debit" >= 0 and "journal_lines"."credit" >= 0 and ("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"seller_id" uuid,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_type_chk" CHECK ("ledger_accounts"."type" in ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY'))
);
--> statement-breakpoint
CREATE TABLE "ledger_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"seller_id" uuid NOT NULL,
	"seller_order_id" uuid,
	"amount" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_adjustments_status_chk" CHECK ("ledger_adjustments"."status" in ('PENDING_APPROVAL', 'POSTED', 'REJECTED')),
	CONSTRAINT "ledger_adjustments_amount_chk" CHECK ("ledger_adjustments"."amount" <> 0),
	CONSTRAINT "ledger_adjustments_checker_chk" CHECK ("ledger_adjustments"."approved_by" is null or "ledger_adjustments"."approved_by" <> "ledger_adjustments"."created_by")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"item_count" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"source" text DEFAULT 'ON_DEMAND' NOT NULL,
	"settlement_id" uuid,
	"payout_method_id" uuid,
	"payout_type" text NOT NULL,
	"payout_masked" text NOT NULL,
	"client_key" text NOT NULL,
	"requested_by" uuid,
	"sla_due_at" timestamp with time zone NOT NULL,
	"requires_dual_control" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"processing_by" uuid,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_reference" text,
	"proof_file_id" uuid,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_status_chk" CHECK ("withdrawal_requests"."status" in ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "withdrawals_amount_chk" CHECK ("withdrawal_requests"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cms_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement" text DEFAULT 'HOME' NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_blocks_type_chk" CHECK ("cms_blocks"."type" in ('HERO', 'BANNER', 'FEATURED_CATEGORIES', 'PRODUCT_RAIL', 'FEATURED_SELLERS', 'DEAL_CTA', 'TRUST', 'FOOTER'))
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('PENDING', 'RUNNING', 'DONE', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_code" text NOT NULL,
	"version" text NOT NULL,
	"context" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_status_chk" CHECK ("legal_documents"."status" in ('DRAFT', 'APPROVED', 'RETIRED'))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_event_channel_pk" PRIMARY KEY("event","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"event" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"attachment_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigint DEFAULT nextval('doc_number_seq') NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"seller_id" uuid,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"assignee_id" uuid,
	"related_type" text,
	"related_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "support_tickets_status_chk" CHECK ("support_tickets"."status" in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SELLER', 'ESCALATED', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "support_tickets_type_chk" CHECK ("support_tickets"."type" in ('ORDER', 'PAYMENT', 'SHIPPING', 'RETURN', 'PRODUCT', 'SELLER', 'EXTERNAL_DEAL', 'ACCOUNT')),
	CONSTRAINT "support_tickets_priority_chk" CHECK ("support_tickets"."priority" in ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_payout_methods" ADD CONSTRAINT "seller_payout_methods_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_payout_methods" ADD CONSTRAINT "seller_payout_methods_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_payout_methods" ADD CONSTRAINT "seller_payout_methods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_shipping_rates" ADD CONSTRAINT "seller_shipping_rates_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_shipping_rates" ADD CONSTRAINT "seller_shipping_rates_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_banner_file_id_files_id_fk" FOREIGN KEY ("banner_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_return_governorate_id_governorates_id_fk" FOREIGN KEY ("return_governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_policy_rules" ADD CONSTRAINT "listing_policy_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation_events" ADD CONSTRAINT "product_moderation_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation_events" ADD CONSTRAINT "product_moderation_events_revision_id_product_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."product_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation_events" ADD CONSTRAINT "product_moderation_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_destinations" ADD CONSTRAINT "payment_destinations_method_code_payment_methods_code_fk" FOREIGN KEY ("method_code") REFERENCES "public"."payment_methods"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_destinations" ADD CONSTRAINT "payment_destinations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_proof_file_id_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_destination_id_payment_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payment_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_proof_file_id_files_id_fk" FOREIGN KEY ("paid_proof_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_receipt_confirmed_by_users_id_fk" FOREIGN KEY ("receipt_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_evidence" ADD CONSTRAINT "deal_evidence_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_evidence" ADD CONSTRAINT "deal_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_evidence" ADD CONSTRAINT "deal_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD CONSTRAINT "deal_invitations_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_invitations" ADD CONSTRAINT "deal_invitations_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_payouts" ADD CONSTRAINT "deal_payouts_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_payouts" ADD CONSTRAINT "deal_payouts_payee_user_id_users_id_fk" FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_payouts" ADD CONSTRAINT "deal_payouts_paid_proof_file_id_files_id_fk" FOREIGN KEY ("paid_proof_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_payouts" ADD CONSTRAINT "deal_payouts_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_deals" ADD CONSTRAINT "external_deals_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_deals" ADD CONSTRAINT "external_deals_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_deal_id_external_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."external_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondent_seller_id_sellers_id_fk" FOREIGN KEY ("respondent_seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_respondent_user_id_users_id_fk" FOREIGN KEY ("respondent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_reviews" ADD CONSTRAINT "seller_reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payout_method_id_seller_payout_methods_id_fk" FOREIGN KEY ("payout_method_id") REFERENCES "public"."seller_payout_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_processing_by_users_id_fk" FOREIGN KEY ("processing_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_proof_file_id_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_blocks" ADD CONSTRAINT "cms_blocks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_history_entity_idx" ON "status_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone") WHERE "users"."phone" is not null;--> statement-breakpoint
CREATE INDEX "users_staff_idx" ON "users" USING btree ("is_staff");--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_uq" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "risk_flags_entity_idx" ON "risk_flags" USING btree ("entity_type","entity_id","status");--> statement-breakpoint
CREATE INDEX "seller_documents_seller_idx" ON "seller_documents" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "seller_members_user_idx" ON "seller_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seller_payout_methods_seller_idx" ON "seller_payout_methods" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_owner_uq" ON "sellers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "sellers_status_idx" ON "sellers" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_seller_uq" ON "stores" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_uq" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_options_uq" ON "attribute_options" USING btree ("attribute_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_code_uq" ON "attributes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_uq" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "categories_path_gin" ON "categories" USING gin ("path");--> statement-breakpoint
CREATE INDEX "inv_mov_variant_idx" ON "inventory_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_res_order_item_uq" ON "inventory_reservations" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "inv_res_active_idx" ON "inventory_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "pav_attr_values_gin" ON "product_attribute_values" USING gin ("values");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "pme_product_idx" ON "product_moderation_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_revisions_product_idx" ON "product_revisions" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_revisions_one_open_uq" ON "product_revisions" USING btree ("product_id") WHERE "product_revisions"."status" = 'SUBMITTED';--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_seller_idx" ON "products" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "products_live_price_idx" ON "products" USING btree ("min_price") WHERE "products"."status" = 'LIVE';--> statement-breakpoint
CREATE INDEX "products_live_new_idx" ON "products" USING btree ("published_at") WHERE "products"."status" = 'LIVE';--> statement-breakpoint
CREATE INDEX "products_search_gin" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_search_trgm" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_uq" ON "cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_user_uq" ON "carts" USING btree ("user_id") WHERE "carts"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_guest_uq" ON "carts" USING btree ("guest_token_hash") WHERE "carts"."guest_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "commission_rules_category_idx" ON "commission_rules" USING btree ("category_id","effective_from");--> statement-breakpoint
CREATE INDEX "order_items_so_idx" ON "order_items" USING btree ("seller_order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_key_uq" ON "orders" USING btree ("customer_id","checkout_key");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","placed_at");--> statement-breakpoint
CREATE INDEX "payment_destinations_method_idx" ON "payment_destinations" USING btree ("method_code","is_enabled");--> statement-breakpoint
CREATE INDEX "payment_submissions_payment_idx" ON "payment_submissions" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_client_key_uq" ON "payment_submissions" USING btree ("payment_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_one_open_uq" ON "payment_submissions" USING btree ("payment_id") WHERE "payment_submissions"."status" = 'SUBMITTED';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" USING btree ("order_id") WHERE "payments"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_deal_uq" ON "payments" USING btree ("deal_id") WHERE "payments"."deal_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_number_uq" ON "refunds" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_source_uq" ON "refunds" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refunds_customer_idx" ON "refunds" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_order_suffix_uq" ON "seller_orders" USING btree ("order_id","suffix");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_order_seller_uq" ON "seller_orders" USING btree ("order_id","seller_id");--> statement-breakpoint
CREATE INDEX "seller_orders_seller_idx" ON "seller_orders" USING btree ("seller_id","status","created_at");--> statement-breakpoint
CREATE INDEX "seller_orders_status_idx" ON "seller_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_documents_shipment_idx" ON "shipment_documents" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_so_uq" ON "shipments" USING btree ("seller_order_id");--> statement-breakpoint
CREATE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "shipments_carrier_idx" ON "shipments" USING btree ("carrier_name","shipped_at");--> statement-breakpoint
CREATE INDEX "tracking_events_shipment_idx" ON "tracking_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "deal_evidence_deal_idx" ON "deal_evidence" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_invitations_token_uq" ON "deal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "deal_invitations_deal_idx" ON "deal_invitations" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_payouts_deal_uq" ON "deal_payouts" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_deals_number_uq" ON "external_deals" USING btree ("number");--> statement-breakpoint
CREATE INDEX "external_deals_buyer_idx" ON "external_deals" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "external_deals_seller_idx" ON "external_deals" USING btree ("seller_user_id");--> statement-breakpoint
CREATE INDEX "external_deals_status_idx" ON "external_deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispute_evidence_dispute_idx" ON "dispute_evidence" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "dispute_messages_dispute_idx" ON "dispute_messages" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_number_uq" ON "disputes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_open_so_uq" ON "disputes" USING btree ("seller_order_id") WHERE "disputes"."seller_order_id" is not null and "disputes"."status" in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION');--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_open_deal_uq" ON "disputes" USING btree ("deal_id") WHERE "disputes"."deal_id" is not null and "disputes"."status" in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION');--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_item_uq" ON "product_reviews" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "product_reviews_product_idx" ON "product_reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "return_evidence_return_idx" ON "return_evidence" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_uq" ON "return_items" USING btree ("return_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_number_uq" ON "returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "returns_seller_idx" ON "returns" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "returns_so_idx" ON "returns" USING btree ("seller_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_uq" ON "review_reports" USING btree ("review_type","review_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "review_reports_status_idx" ON "review_reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_reviews_so_uq" ON "seller_reviews" USING btree ("seller_order_id");--> statement-breakpoint
CREATE INDEX "seller_reviews_seller_idx" ON "seller_reviews" USING btree ("seller_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_idem_uq" ON "journal_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_created_idx" ON "journal_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_platform_uq" ON "ledger_accounts" USING btree ("code") WHERE "ledger_accounts"."seller_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_seller_uq" ON "ledger_accounts" USING btree ("code","seller_id") WHERE "ledger_accounts"."seller_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_adjustments_number_uq" ON "ledger_adjustments" USING btree ("number");--> statement-breakpoint
CREATE INDEX "ledger_adjustments_status_idx" ON "ledger_adjustments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_date_uq" ON "settlements" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_number_uq" ON "settlements" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_number_uq" ON "withdrawal_requests" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_client_key_uq" ON "withdrawal_requests" USING btree ("seller_id","client_key");--> statement-breakpoint
CREATE INDEX "withdrawals_seller_idx" ON "withdrawal_requests" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawal_requests" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "cms_blocks_placement_idx" ON "cms_blocks" USING btree ("placement","is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_slug_uq" ON "cms_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_idx" ON "legal_acceptances" USING btree ("user_id","document_code");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_version_uq" ON "legal_documents" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_current_uq" ON "legal_documents" USING btree ("code") WHERE "legal_documents"."is_current";--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbound_status_idx" ON "outbound_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number_uq" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "support_tickets_requester_idx" ON "support_tickets" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","priority");