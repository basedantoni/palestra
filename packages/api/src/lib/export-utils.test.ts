import { describe, expect, it } from "vitest";

import { escapeCsvValue, rowsToCsv } from "./export-utils";

describe("export-utils", () => {
  describe("escapeCsvValue", () => {
    it("should leave simple values unquoted", () => {
      expect(escapeCsvValue("bench press")).toBe("bench press");
      expect(escapeCsvValue(123)).toBe("123");
    });

    it("should quote and escape values containing csv special chars", () => {
      expect(escapeCsvValue('a "quote" value')).toBe('"a ""quote"" value"');
      expect(escapeCsvValue("a,b")).toBe('"a,b"');
      expect(escapeCsvValue("a\nb")).toBe('"a\nb"');
    });

    it("should return empty string for nullish values", () => {
      expect(escapeCsvValue(null)).toBe("");
      expect(escapeCsvValue(undefined)).toBe("");
    });
  });

  describe("rowsToCsv", () => {
    it("should generate csv with selected columns and row values", () => {
      const csv = rowsToCsv(
        [
          { id: "1", name: "Bench Press", sets: 3 },
          { id: "2", name: "Squat", sets: 4 },
        ],
        ["id", "name", "sets"],
      );

      expect(csv).toBe("id,name,sets\n1,Bench Press,3\n2,Squat,4");
    });

    it("should return header only when rows are empty", () => {
      const csv = rowsToCsv([], ["id", "name"]);
      expect(csv).toBe("id,name");
    });
  });
});
