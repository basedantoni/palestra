-- KOI-342: existing rows are backfilled as reviewed; new rows start Unreviewed.
ALTER TABLE "transaction" ADD COLUMN "reviewed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "reviewed" SET DEFAULT false;
