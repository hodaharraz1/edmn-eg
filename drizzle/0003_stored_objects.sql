CREATE TABLE "stored_objects" (
	"visibility" text NOT NULL,
	"key" text NOT NULL,
	"data" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_objects_visibility_key_pk" PRIMARY KEY("visibility","key")
);
