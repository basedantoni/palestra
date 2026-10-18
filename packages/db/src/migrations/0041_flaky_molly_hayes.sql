ALTER TABLE "category" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_parentId_idx" ON "category" USING btree ("parent_id");