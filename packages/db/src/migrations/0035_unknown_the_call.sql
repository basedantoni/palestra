ALTER TABLE "tcg_copy" ADD COLUMN "want_id" uuid;--> statement-breakpoint
ALTER TABLE "tcg_want" ADD COLUMN "bought_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "tcg_copy" ADD CONSTRAINT "tcg_copy_want_id_tcg_want_id_fk" FOREIGN KEY ("want_id") REFERENCES "public"."tcg_want"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_want" ADD CONSTRAINT "tcg_want_bought_offer_id_tcg_offer_id_fk" FOREIGN KEY ("bought_offer_id") REFERENCES "public"."tcg_offer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_want" ADD CONSTRAINT "tcg_want_bought_offer_while_ordered" CHECK (("tcg_want"."status" in ('ordered', 'fulfilled')) = ("tcg_want"."bought_offer_id" is not null));