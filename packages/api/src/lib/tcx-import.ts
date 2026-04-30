export interface ParsedTcxRun {
  fileName: string;
  startedAt: string;
  durationSeconds: number;
  distanceMeter: number;
  calories: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
}

function toNumber(value: string | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1]?.trim();
}

function tagValue(value: string, tagName: string): string | undefined {
  return firstMatch(
    value,
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`),
  );
}

function tagValues(value: string, tagName: string): string[] {
  const pattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`,
    "g",
  );
  const matches: string[] = [];

  for (const match of value.matchAll(pattern)) {
    if (match[1] != null) {
      matches.push(match[1]);
    }
  }

  return matches;
}

export function fingerprintTcxRun(
  startedAt: string | Date,
  distanceMeter: number,
): string {
  const date =
    startedAt instanceof Date ? startedAt : new Date(String(startedAt).trim());

  return `${date.toISOString()}|${Math.round(distanceMeter / 10) * 10}`;
}

export function parseTcxRun(
  fileName: string,
  xml: string,
): ParsedTcxRun | null {
  const activity = firstMatch(
    xml,
    /<Activity\b[^>]*Sport=(?:"Running"|'Running')[^>]*>([\s\S]*?)<\/Activity>/,
  );

  if (!activity) {
    return null;
  }

  const laps = tagValues(activity, "Lap");
  if (laps.length === 0) {
    return null;
  }

  let durationSeconds = 0;
  let distanceMeter = 0;
  let calories = 0;
  let avgHrSum = 0;
  let avgHrCount = 0;
  let maxHeartRate: number | null = null;

  for (const lap of laps) {
    durationSeconds += toNumber(tagValue(lap, "TotalTimeSeconds")) ?? 0;
    distanceMeter += toNumber(tagValue(lap, "DistanceMeters")) ?? 0;
    calories += toNumber(tagValue(lap, "Calories")) ?? 0;

    const avgHeartRate = toNumber(
      tagValue(tagValue(lap, "AverageHeartRateBpm") ?? "", "Value"),
    );
    if (avgHeartRate != null) {
      avgHrSum += avgHeartRate;
      avgHrCount += 1;
    }

    const lapMaxHeartRate = toNumber(
      tagValue(tagValue(lap, "MaximumHeartRateBpm") ?? "", "Value"),
    );
    if (lapMaxHeartRate != null) {
      maxHeartRate =
        maxHeartRate == null
          ? lapMaxHeartRate
          : Math.max(maxHeartRate, lapMaxHeartRate);
    }
  }

  const startedAt = new Date(tagValue(activity, "Id") ?? "");
  if (Number.isNaN(startedAt.getTime())) {
    return null;
  }

  return {
    fileName,
    startedAt: startedAt.toISOString(),
    durationSeconds: Math.round(durationSeconds),
    distanceMeter,
    calories: calories > 0 ? calories : null,
    avgHeartRate: avgHrCount > 0 ? Math.round(avgHrSum / avgHrCount) : null,
    maxHeartRate,
  };
}
