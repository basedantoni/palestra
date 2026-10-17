ALTER TABLE "category" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- KOI-336 backfill: seeded categories take the SEED_CATEGORIES order and distinct
-- palette colors (Income and Transfers none: they leave in KOI-341); custom ones
-- follow by name, taking palette colors in order.
WITH seed(name, ord, color) AS (
	VALUES
		('Income', 0, NULL), ('Transfers', 1, NULL), ('Food & Drink', 2, 'blue'), ('Shopping', 3, 'orange'),
		('Transportation', 4, 'aqua'), ('Rent & Utilities', 5, 'yellow'), ('Home', 6, 'magenta'),
		('Entertainment', 7, 'violet'), ('Travel', 8, 'brown'), ('Medical', 9, 'purple'),
		('Personal Care', 10, 'olive'), ('Services', 11, 'sky'), ('Loan Payments', 12, 'red'),
		('Bank Fees', 13, 'plum'), ('Government & Non-Profit', 14, 'green')
), ranked AS (
	SELECT c.id, s.name IS NULL AS custom, s.color AS seed_color,
		row_number() OVER (PARTITION BY c.user_id ORDER BY s.ord NULLS LAST, c.name) - 1 AS pos,
		row_number() OVER (PARTITION BY c.user_id, s.name IS NULL ORDER BY c.name) - 1 AS custom_pos
	FROM "category" c LEFT JOIN seed s ON c.is_system AND s.name = c.name
)
UPDATE "category" SET "sort_order" = r.pos, "color" = CASE WHEN r.custom
	THEN (ARRAY['blue','orange','aqua','yellow','magenta','violet','brown','purple','olive','sky','red','plum','green'])[r.custom_pos % 13 + 1]
	ELSE r.seed_color END
FROM ranked r WHERE "category".id = r.id;
