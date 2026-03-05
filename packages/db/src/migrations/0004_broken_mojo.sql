DELETE FROM "progressive_overload_state" AS pos
USING (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY "user_id", "exercise_id"
      ORDER BY "last_calculated_at" DESC, "id" DESC
    ) AS row_num
  FROM "progressive_overload_state"
) AS ranked
WHERE pos.ctid = ranked.ctid
  AND ranked.row_num > 1;

CREATE UNIQUE INDEX "progressive_overload_state_user_exercise_uq"
  ON "progressive_overload_state" USING btree ("user_id", "exercise_id");
