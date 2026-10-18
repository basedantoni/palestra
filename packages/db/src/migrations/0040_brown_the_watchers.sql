ALTER TABLE "category" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- KOI-336 backfill: seeded categories take the SEED_CATEGORIES order, distinct
-- palette colors (Income and Transfers none: they leave in KOI-341) and their
-- seed icon; custom ones follow by name, taking palette colors in order, no icon.
WITH seed(name, ord, color, icon) AS (
	VALUES
		('Income', 0, NULL, 'banknote'), ('Transfers', 1, NULL, 'arrow-left-right'),
		('Food & Drink', 2, 'blue', 'utensils'), ('Shopping', 3, 'orange', 'shopping-bag'),
		('Transportation', 4, 'aqua', 'car'), ('Rent & Utilities', 5, 'yellow', 'house'),
		('Home', 6, 'magenta', 'hammer'), ('Entertainment', 7, 'violet', 'film'),
		('Travel', 8, 'brown', 'plane'), ('Medical', 9, 'purple', 'heart-pulse'),
		('Personal Care', 10, 'olive', 'scissors'), ('Services', 11, 'sky', 'wrench'),
		('Loan Payments', 12, 'red', 'hand-coins'), ('Bank Fees', 13, 'plum', 'receipt'),
		('Government & Non-Profit', 14, 'green', 'landmark')
), ranked AS (
	SELECT c.id, s.name IS NULL AS custom, s.color AS seed_color, s.icon AS seed_icon,
		row_number() OVER (PARTITION BY c.user_id ORDER BY s.ord NULLS LAST, c.name) - 1 AS pos,
		row_number() OVER (PARTITION BY c.user_id, s.name IS NULL ORDER BY c.name) - 1 AS custom_pos
	FROM "category" c LEFT JOIN seed s ON c.is_system AND s.name = c.name
)
UPDATE "category" SET "sort_order" = r.pos, "icon" = r.seed_icon, "color" = CASE WHEN r.custom
	THEN (ARRAY['blue','orange','aqua','yellow','magenta','violet','brown','purple','olive','sky','red','plum','green'])[r.custom_pos % 13 + 1]
	ELSE r.seed_color END
FROM ranked r WHERE "category".id = r.id;
