import { describe, expect, it } from "vitest";

import { fingerprintTcxRun, parseTcxRun } from "./tcx-import";

function tcxActivity(sport: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="${sport}">
      <Id>2022-10-29T19:05:05.526Z</Id>
      ${body}
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

function lap({
  duration,
  distance,
  calories,
  avgHr,
  maxHr,
}: {
  duration: number;
  distance: number;
  calories: number;
  avgHr?: number;
  maxHr?: number;
}): string {
  return `<Lap StartTime="2022-10-29T19:05:05.526Z">
  <TotalTimeSeconds>${duration}</TotalTimeSeconds>
  <DistanceMeters>${distance}</DistanceMeters>
  <Calories>${calories}</Calories>
  ${
    avgHr == null
      ? ""
      : `<AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm>`
  }
  ${
    maxHr == null
      ? ""
      : `<MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>`
  }
</Lap>`;
}

describe("tcx-import", () => {
  describe("parseTcxRun", () => {
    it("parses a single-lap running TCX", () => {
      const result = parseTcxRun(
        "single.tcx",
        tcxActivity(
          "Running",
          lap({ duration: 1812.4, distance: 4002.1, calories: 321 }),
        ),
      );

      expect(result).toEqual({
        fileName: "single.tcx",
        startedAt: "2022-10-29T19:05:05.526Z",
        durationSeconds: 1812,
        distanceMeter: 4002.1,
        calories: 321,
        avgHeartRate: null,
        maxHeartRate: null,
      });
    });

    it("parses a multi-lap running TCX and sums duration, distance, and calories", () => {
      const result = parseTcxRun(
        "multi.tcx",
        tcxActivity(
          "Running",
          [
            lap({ duration: 1200.2, distance: 3000.25, calories: 250 }),
            lap({ duration: 1400.6, distance: 3500.75, calories: 275 }),
          ].join("\n"),
        ),
      );

      expect(result?.durationSeconds).toBe(2601);
      expect(result?.distanceMeter).toBe(6501);
      expect(result?.calories).toBe(525);
    });

    it("extracts average and maximum heart rate from lap heart-rate nodes", () => {
      const result = parseTcxRun(
        "hr.tcx",
        tcxActivity(
          "Running",
          [
            lap({
              duration: 1200,
              distance: 3000,
              calories: 200,
              avgHr: 141,
              maxHr: 168,
            }),
            lap({
              duration: 1200,
              distance: 3000,
              calories: 200,
              avgHr: 152,
              maxHr: 174,
            }),
          ].join("\n"),
        ),
      );

      expect(result?.avgHeartRate).toBe(147);
      expect(result?.maxHeartRate).toBe(174);
    });

    it("returns null for a non-running TCX activity", () => {
      const result = parseTcxRun(
        "cycling.tcx",
        tcxActivity("Biking", lap({ duration: 600, distance: 5000, calories: 100 })),
      );

      expect(result).toBeNull();
    });

    it("returns null for a running TCX activity without a valid activity id", () => {
      const result = parseTcxRun(
        "missing-id.tcx",
        `<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Running">
      ${lap({ duration: 600, distance: 5000, calories: 100 })}
    </Activity>
  </Activities>
</TrainingCenterDatabase>`,
      );

      expect(result).toBeNull();
    });
  });

  describe("fingerprintTcxRun", () => {
    it("builds a stable timestamp and rounded-distance fingerprint", () => {
      expect(fingerprintTcxRun("2022-10-29T19:05:05.526Z", 14920.372)).toBe(
        "2022-10-29T19:05:05.526Z|14920",
      );
      expect(fingerprintTcxRun(new Date("2022-10-29T19:05:05.526Z"), 14924.9))
        .toBe("2022-10-29T19:05:05.526Z|14920");
    });
  });
});
