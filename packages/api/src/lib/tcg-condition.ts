import { tcgConditionEnum } from "@life-tracker/db/schema/index";

type Condition = (typeof tcgConditionEnum.enumValues)[number];

/** Whether `condition` is worse than `min` on the ordered scale NM > LP > MP > HP > DMG (best first). */
export function isBelowCondition(condition: Condition, min: Condition) {
  return tcgConditionEnum.enumValues.indexOf(condition) > tcgConditionEnum.enumValues.indexOf(min);
}
