import { describe, expect, it } from "vitest";

import {
  buildCalendarDayMetadata,
  getLocalDateKey,
  getLocalMonthRange,
  groupWorkoutsByLocalDay,
} from "./workout-history-calendar";

describe("workout-history-calendar", () => {
  describe("getLocalDateKey", () => {
    it("returns local YYYY-MM-DD keys", () => {
      const date = new Date("2026-03-10T15:30:00.000Z");
      const key = getLocalDateKey(date);
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("groupWorkoutsByLocalDay", () => {
    it("groups workouts by local day", () => {
      const grouped = groupWorkoutsByLocalDay([
        { id: "w1", date: new Date("2026-03-10T08:00:00.000Z"), totalVolume: 1000 },
        { id: "w2", date: new Date("2026-03-10T18:00:00.000Z"), totalVolume: 800 },
        { id: "w3", date: new Date("2026-03-11T08:00:00.000Z"), totalVolume: 700 },
      ]);

      const keys = Object.keys(grouped).sort();
      expect(keys.length).toBe(2);
      expect(grouped[keys[0] ?? ""]?.length).toBe(2);
      expect(grouped[keys[1] ?? ""]?.length).toBe(1);
    });
  });

  describe("buildCalendarDayMetadata", () => {
    it("builds count and volume metadata for each day", () => {
      const grouped = groupWorkoutsByLocalDay([
        { id: "w1", date: new Date("2026-03-10T08:00:00.000Z"), totalVolume: 1000 },
        { id: "w2", date: new Date("2026-03-10T18:00:00.000Z"), totalVolume: 800 },
      ]);

      const metadata = buildCalendarDayMetadata(grouped);
      const first = metadata[Object.keys(metadata)[0] ?? ""];

      expect(first?.count).toBe(2);
      expect(first?.totalVolume).toBe(1800);
    });
  });

  describe("getLocalMonthRange", () => {
    it("returns inclusive month range boundaries", () => {
      const { startDate, endDate } = getLocalMonthRange(
        new Date("2026-03-15T12:00:00.000Z"),
      );

      expect(startDate.getDate()).toBe(1);
      expect(startDate.getHours()).toBe(0);
      expect(startDate.getMinutes()).toBe(0);
      expect(startDate.getSeconds()).toBe(0);

      expect(endDate.getMonth()).toBe(startDate.getMonth());
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
      expect(endDate.getSeconds()).toBe(59);
    });
  });
});
