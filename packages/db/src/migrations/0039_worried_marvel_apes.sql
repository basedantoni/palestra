CREATE TABLE "bank_category_mapping" (
	"user_id" text NOT NULL,
	"pfc_primary" text NOT NULL,
	"category_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_category_mapping_user_id_pfc_primary_pk" PRIMARY KEY("user_id","pfc_primary")
);
--> statement-breakpoint
ALTER TABLE "bank_category_mapping" ADD CONSTRAINT "bank_category_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_category_mapping" ADD CONSTRAINT "bank_category_mapping_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;