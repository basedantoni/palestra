// ---- Types ----

export type WorkoutType =
  | "weightlifting"
  | "hiit"
  | "cardio"
  | "calisthenics"
  | "yoga"
  | "sports"
  | "mixed";

export interface ParsedSet {
  setNumber: number;
  reps: number | undefined;
  weight: number | undefined;
  rpe: number | undefined;
  durationSeconds: number | undefined;
}

export interface ParsedExercise {
  name: string; // raw name from markdown (e.g., "Zercher Squats")
  sets: ParsedSet[];
  notes: string; // any extra text, sub-bullets, parenthetical notes
  isSkipped: boolean; // true if wrapped in ~~strikethrough~~
  // HIIT/EMOM fields
  rounds: number | undefined;
  workDurationSeconds: number | undefined;
  restDurationSeconds: number | undefined;
}

export interface ParsedWorkout {
  date: Date; // parsed from YYYYMMDD
  exercises: ParsedExercise[];
  isRestDay: boolean; // true if "Rest Day", "Skipped", "Recovery", "Mobility", etc.
  rawText: string; // original text block for this day (useful for preview)
}

export interface ParseResult {
  workouts: ParsedWorkout[];
  uniqueExerciseNames: string[]; // deduplicated, excludes rest days and skipped exercises
  parseWarnings: ParseWarning[];
}

export interface ParseWarning {
  date: string; // YYYYMMDD
  line: string; // the problematic line
  message: string; // human-readable warning
}

// ---- Rest day keywords ----

const REST_DAY_KEYWORDS = [
  "rest",
  "skip",
  "skipped",
  "recovery",
  "mobility",
  "debauchery",
  "hangover",
];

function isRestDayLine(line: string): boolean {
  const lower = line.toLowerCase().trim();
  // Must not be a structured exercise line (cardio/timed exercises can contain "recovery")
  // A rest day line is short and is primarily a rest/skip indicator
  // Reject if the line has set patterns or cardio patterns (e.g., "recovery pace")
  if (/\d+\s*x\s*\d+/i.test(lower)) return false;
  if (/\b(?:mins?|pace|pace)\b/.test(lower) && lower.length > 30) return false;
  return REST_DAY_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---- Normalization helpers ----

function parseDateStr(yyyymmdd: string): Date {
  const year = parseInt(yyyymmdd.slice(0, 4), 10);
  const month = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const day = parseInt(yyyymmdd.slice(6, 8), 10);
  // Use noon UTC to avoid timezone issues
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

// ---- Set parsing helpers ----

interface SetGroup {
  sets: number;
  reps: number | undefined;
  durationSeconds: number | undefined;
}

/**
 * Parse set groups like "3 x 8", "2 x 8, 1 x 10", "3 x 60s"
 * Returns array of set groups (each group describes count + reps/duration per set)
 */
function parseSetGroups(str: string): SetGroup[] {
  const groups: SetGroup[] = [];
  // Match patterns like "2 x 8", "1 x 10", "3 x 60s"
  const groupPattern = /(\d+)\s*x\s*(\d+)(s)?/gi;
  let match;
  while ((match = groupPattern.exec(str)) !== null) {
    const sets = parseInt(match[1]!, 10);
    const count = parseInt(match[2]!, 10);
    const isTimed = !!match[3];
    groups.push({
      sets,
      reps: isTimed ? undefined : count,
      durationSeconds: isTimed ? count : undefined,
    });
  }
  return groups;
}

/**
 * Parse weight from string, returns { weight, notes } or null
 * Handles: "135lbs", "135lb", "135kg", "BW", "24""
 */
function parseWeight(
  str: string,
): { weight: number | undefined; notes: string } {
  // Bodyweight
  if (/\bBW\b/i.test(str)) {
    return { weight: 0, notes: "Bodyweight" };
  }

  // Height notation like "24"" — not a weight
  if (/"/.test(str)) {
    const heightMatch = str.match(/(\d+(?:\.\d+)?)\s*"/);
    if (heightMatch) {
      return { weight: undefined, notes: `${heightMatch[1]}"` };
    }
  }

  // w/ Nlb[s] pattern (medicine ball, KB, etc.)
  const withWeightMatch = str.match(/w\/\s*(\d+(?:\.\d+)?)\s*lb/i);
  if (withWeightMatch) {
    const weight = parseFloat(withWeightMatch[1]!);
    // Extract descriptor after "w/"
    const descMatch = str.match(/w\/\s*(.+)/i);
    const notes = descMatch ? descMatch[1]!.trim() : "";
    return { weight, notes };
  }

  // Standard weight: @ Nlbs / @ Nkg / @ N
  const weightMatch = str.match(/@\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)?/i);
  if (weightMatch) {
    return { weight: parseFloat(weightMatch[1]!), notes: "" };
  }

  return { weight: undefined, notes: "" };
}

/**
 * Parse RPE from string
 */
function parseRpe(str: string): number | undefined {
  const match = str.match(/\brpe\s*(\d+)/i);
  return match ? parseInt(match[1]!, 10) : undefined;
}

/**
 * Parse per-set rep overrides like:
 * "9 on 3rd set" -> {setIndex: 2 (0-based), reps: 9}
 * "last set 10" -> {setIndex: -1 (last), reps: 10}
 * "12 reps last set" -> {setIndex: -1, reps: 12}
 * "12 on last set" -> {setIndex: -1, reps: 12}
 * "7 on last set" -> {setIndex: -1, reps: 7}
 */
interface SetOverride {
  setIndex: number; // 0-based, or -1 for last
  reps: number;
}

const ORDINAL_MAP: Record<string, number> = {
  "1st": 0,
  "2nd": 1,
  "3rd": 2,
  "4th": 3,
  "5th": 4,
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
};

function parseSetOverrides(str: string): SetOverride[] {
  const overrides: SetOverride[] = [];

  // "N on Xth set" or "N on X set"
  const ordinalPattern =
    /(\d+)\s+(?:reps?\s+)?on\s+(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s+set/gi;
  let match;
  while ((match = ordinalPattern.exec(str)) !== null) {
    const reps = parseInt(match[1]!, 10);
    const ordinal = match[2]!.toLowerCase();
    if (ordinal in ORDINAL_MAP) {
      overrides.push({ setIndex: ORDINAL_MAP[ordinal]!, reps });
    }
  }

  // "last set N" or "N on last set" or "N reps last set" or "N on last set*"
  const lastSetPattern =
    /(?:last\s+set\s+(\d+)|(\d+)\s+(?:reps?\s+)?(?:on\s+)?last\s+set)/gi;
  while ((match = lastSetPattern.exec(str)) !== null) {
    const reps = parseInt((match[1] ?? match[2])!, 10);
    overrides.push({ setIndex: -1, reps });
  }

  return overrides;
}

/**
 * Apply set overrides to a list of sets in-place
 */
function applySetOverrides(sets: ParsedSet[], overrides: SetOverride[]): void {
  for (const override of overrides) {
    const idx = override.setIndex === -1 ? sets.length - 1 : override.setIndex;
    if (idx >= 0 && idx < sets.length) {
      sets[idx]!.reps = override.reps;
    }
  }
}

// ---- EMOM pattern ----

/**
 * Match "30 KB Swings EMOM x 5 @ 40lbs"
 * Returns null if not an EMOM line
 */
interface EmomParsed {
  name: string;
  repsPerRound: number;
  rounds: number;
  weight: number | undefined;
  weightNotes: string;
}

function parseEmom(line: string): EmomParsed | null {
  // Pattern: N Name EMOM x R @ W
  const emomPattern =
    /^(\d+)\s+(.+?)\s+EMOM\s+x\s+(\d+)(?:\s+@\s+(.+))?$/i;
  const match = line.match(emomPattern);
  if (!match) return null;

  const repsPerRound = parseInt(match[1]!, 10);
  const name = match[2]!.trim();
  const rounds = parseInt(match[3]!, 10);
  const weightStr = match[4] ?? "";

  const { weight, notes } = parseWeight(
    weightStr ? `@ ${weightStr}` : "",
  );

  return {
    name,
    repsPerRound,
    rounds,
    weight,
    weightNotes: notes,
  };
}

// ---- Main exercise line parser ----

/**
 * Determine if a line looks like a cardio/free-text line even if it contains N x N.
 * E.g., "Norwegian 4x4 - Treadmill Run - 4mins @ 12:00 pace"
 */
function isCardioLine(line: string): boolean {
  // Lines with time-based indicators that aren't exercise sets
  return /\b(?:\d+\s*mins?|pace|treadmill|stairmaster|elliptical|lvl\s*\d|\d+:\d+\s*pace)\b/i.test(line);
}

/**
 * Determine if a line has a structured set pattern (N x N or EMOM).
 * Excludes lines that look like cardio/free-text even if they contain N x N.
 */
export function hasSetPattern(line: string): boolean {
  if (isCardioLine(line)) return false;
  return /\d+\s*x\s*\d+/i.test(line) || /EMOM/i.test(line);
}

/**
 * Parse a single exercise line into a ParsedExercise.
 * Returns null if the line cannot be parsed as an exercise.
 */
function parseExerciseLine(rawLine: string): ParsedExercise | null {
  let line = rawLine.trim();
  if (!line) return null;

  // Handle strikethrough
  let isSkipped = false;
  if (line.startsWith("~~") && line.endsWith("~~")) {
    isSkipped = true;
    line = line.slice(2, -2).trim();
  } else if (line.startsWith("~~")) {
    // Partial strikethrough (malformed), treat as skipped
    isSkipped = true;
    line = line.replace(/^~~/, "").replace(/~~$/, "").trim();
  }

  // Remove trailing asterisks and spaces
  line = line.replace(/\*+\s*$/, "").trim();

  // Try EMOM first
  const emom = parseEmom(line);
  if (emom) {
    const sets: ParsedSet[] = [];
    for (let i = 0; i < emom.rounds; i++) {
      sets.push({
        setNumber: i + 1,
        reps: emom.repsPerRound,
        weight: emom.weight,
        rpe: undefined,
        durationSeconds: undefined,
      });
    }
    const notes =
      emom.weightNotes || (emom.weight === 0 ? "Bodyweight" : "");
    return {
      name: emom.name,
      sets,
      notes,
      isSkipped,
      rounds: emom.rounds,
      workDurationSeconds: undefined,
      restDurationSeconds: undefined,
    };
  }

  // Check for set pattern
  if (!hasSetPattern(line)) {
    // No set pattern — cardio/free-text line
    // Extract name as everything before any "@" or notes in parens
    let name = line;
    // Remove parenthetical notes at end
    name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();

    return {
      name,
      sets: [],
      notes: rawLine.trim(),
      isSkipped,
      rounds: undefined,
      workDurationSeconds: undefined,
      restDurationSeconds: undefined,
    };
  }

  // Has set pattern — parse structured exercise
  // Build workLine from the line (already cleaned of ~~ and trailing *)
  let workLine = line;

  // Extract "+" suffix (e.g., "+ Vertical Jumps") that comes after weight
  // Pattern: @ something + Name
  let notesFromPlus = "";
  // Only strip if there's a weight before the plus
  const afterWeightPlusMatch = workLine.match(
    /(@\s*[\w."]+(?:lbs?|kg)?(?:\s+.*?)?)\s*\+\s+(.+)$/i,
  );
  if (afterWeightPlusMatch) {
    notesFromPlus = `+ ${afterWeightPlusMatch[2]!.trim()}`;
    workLine = workLine.replace(/\s*\+\s+[^+]+$/, "").trim();
  }

  // Extract RPE
  const rpe = parseRpe(workLine);

  // Extract per-set overrides (text after the set/weight info)
  const overrides = parseSetOverrides(workLine);

  // Extract weight
  // First, find the "@" position to split name from weight
  const atIdx = workLine.indexOf(" @ ");
  // Also check for "w/" pattern (no "@")
  const withIdx = workLine.toLowerCase().indexOf(" w/");

  // Extract set groups - find them before the "@" or "w/"
  let setStr = workLine;
  let weightStr = "";

  if (atIdx !== -1) {
    setStr = workLine.slice(0, atIdx);
    weightStr = workLine.slice(atIdx + 3);
  } else if (withIdx !== -1) {
    setStr = workLine.slice(0, withIdx);
    weightStr = workLine.slice(withIdx + 1);
  }

  // Parse weight from weight string
  const weightInfo = parseWeight(
    atIdx !== -1 ? `@ ${weightStr}` : withIdx !== -1 ? weightStr : "",
  );

  // Parse set groups
  const setGroups = parseSetGroups(setStr);

  if (setGroups.length === 0) {
    // Has "x" but couldn't parse groups — might be something like "10 sets, 15s @ 80%"
    // Treat as free-text
    return {
      name: workLine.split(/\s+\d+\s*x/)[0]?.trim() ?? workLine.trim(),
      sets: [],
      notes: workLine,
      isSkipped,
      rounds: undefined,
      workDurationSeconds: undefined,
      restDurationSeconds: undefined,
    };
  }

  // Extract exercise name — everything before the first set group
  // The set group starts with a number
  // Find the position of the first digit that starts a "N x M" pattern
  const firstSetGroupMatch = setStr.match(/\d+\s*x\s*\d+/i);
  let exerciseName = setStr;
  if (firstSetGroupMatch) {
    const nameEnd = setStr.indexOf(firstSetGroupMatch[0]);
    exerciseName = setStr.slice(0, nameEnd).trim();
    // Clean up trailing " -" or similar
    exerciseName = exerciseName.replace(/\s*[-–]\s*$/, "").trim();
  }

  // Build sets from groups
  const sets: ParsedSet[] = [];
  let setNumber = 1;
  for (const group of setGroups) {
    for (let i = 0; i < group.sets; i++) {
      sets.push({
        setNumber: setNumber++,
        reps: group.reps,
        weight: weightInfo.weight,
        rpe,
        durationSeconds: group.durationSeconds,
      });
    }
  }

  // Apply overrides
  applySetOverrides(sets, overrides);

  // Build notes
  const noteParts: string[] = [];
  if (weightInfo.notes) noteParts.push(weightInfo.notes);
  if (notesFromPlus) noteParts.push(notesFromPlus);

  // Extract parenthetical notes from original line
  const parenMatch = rawLine.match(/\(([^)]+)\)/);
  if (parenMatch) {
    noteParts.push(parenMatch[1]!.trim());
  }

  return {
    name: exerciseName,
    sets,
    notes: noteParts.join("; "),
    isSkipped,
    rounds: undefined,
    workDurationSeconds: undefined,
    restDurationSeconds: undefined,
  };
}

// ---- Main parser ----

/**
 * Parse workout markdown text into structured workout data.
 */
export function parseWorkoutMarkdown(markdown: string): ParseResult {
  const lines = markdown.split("\n");
  const workouts: ParsedWorkout[] = [];
  const parseWarnings: ParseWarning[] = [];

  let currentDateStr: string | null = null;
  let currentLines: string[] = [];
  let currentDate: Date | null = null;

  const flushWorkout = () => {
    if (!currentDateStr || !currentDate) return;

    const rawText = currentLines.join("\n").trim();
    const exercises: ParsedExercise[] = [];
    let isRestDay = false;

    // Check if entire block is a rest day
    // A block is a rest day if ALL non-empty lines are rest keywords
    const nonEmptyLines = currentLines.filter((l) => l.trim());
    if (nonEmptyLines.length === 0) {
      // Empty block — skip
      currentDateStr = null;
      currentDate = null;
      currentLines = [];
      return;
    }

    // Check: if every non-empty line indicates rest/skip, mark as rest day
    const allRest = nonEmptyLines.every((l) => isRestDayLine(l.trim()));
    if (allRest) {
      isRestDay = true;
    } else {
      // Parse exercises line by line
      let prevExercise: ParsedExercise | null = null;

      for (const rawLine of currentLines) {
        const line = rawLine.trim();
        if (!line) continue;

        // Skip lines that are pure rest day indicators when mixed with exercises
        // (e.g., "9 Holes @ Hancock\nSkipped Gym" - the "Skipped Gym" is informational)

        // Sub-bullet line
        if (line.startsWith("* ")) {
          const subLine = line.slice(2).trim();

          if (hasSetPattern(subLine)) {
            // Child exercise
            const childExercise = parseExerciseLine(subLine);
            if (childExercise) {
              exercises.push(childExercise);
              prevExercise = childExercise;
            }
          } else {
            // Notes on previous exercise
            if (prevExercise) {
              const existingNotes = prevExercise.notes;
              prevExercise.notes = existingNotes
                ? `${existingNotes}; ${subLine}`
                : subLine;
            }
          }
          continue;
        }

        // Regular exercise line
        const exercise = parseExerciseLine(line);
        if (exercise) {
          exercises.push(exercise);
          prevExercise = exercise;
        }
      }
    }

    workouts.push({
      date: currentDate,
      exercises,
      isRestDay,
      rawText,
    });

    currentDateStr = null;
    currentDate = null;
    currentLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check for date header: **YYYYMMDD** (possibly with trailing content like "** **")
    const dateMatch = line.match(/^\*\*(\d{8})\*\*/);
    if (dateMatch) {
      // Flush previous workout
      flushWorkout();

      currentDateStr = dateMatch[1]!;
      currentDate = parseDateStr(currentDateStr);
      currentLines = [];
      continue;
    }

    if (currentDateStr !== null) {
      currentLines.push(rawLine);
    }
  }

  // Flush last workout
  flushWorkout();

  // Collect unique exercise names (excluding skipped exercises and rest days)
  const exerciseNameSet = new Set<string>();
  for (const workout of workouts) {
    if (workout.isRestDay) continue;
    for (const exercise of workout.exercises) {
      if (exercise.isSkipped) continue;
      if (exercise.name) {
        exerciseNameSet.add(exercise.name);
      }
    }
  }

  const uniqueExerciseNames = Array.from(exerciseNameSet).sort((a, b) =>
    a.localeCompare(b),
  );

  return { workouts, uniqueExerciseNames, parseWarnings };
}

// ---- Workout type inference ----

const CARDIO_KEYWORDS = [
  "treadmill",
  "stairmaster",
  "stair master",
  "sprint",
  "bike",
  "cycling",
  "rowing",
  "elliptical",
  "run",
  "jog",
  "walk",
  "golf",
  "holes",
  "swimming",
  "norwegian",
];

/**
 * Infer workout type from the exercises in a workout.
 *
 * Rules:
 * - If any exercise has EMOM/rounds: "hiit"
 * - If any exercise name contains cardio keywords (treadmill, stairmaster, sprint): "cardio"
 * - If ALL exercises are timed (durationSeconds only, no reps): "calisthenics"
 * - If any exercise has reps + weight: "weightlifting"
 * - If mix of types: "mixed"
 * - Default: "weightlifting"
 */
export function inferWorkoutType(exercises: ParsedExercise[]): WorkoutType {
  if (exercises.length === 0) return "weightlifting";

  const nonSkipped = exercises.filter((e) => !e.isSkipped);
  if (nonSkipped.length === 0) return "weightlifting";

  // HIIT / EMOM
  const hasEmom = nonSkipped.some((e) => e.rounds !== undefined && e.rounds > 0);
  if (hasEmom) return "hiit";

  // Cardio keywords in exercise name
  const hasCardio = nonSkipped.some((e) => {
    const nameLower = e.name.toLowerCase();
    return CARDIO_KEYWORDS.some((kw) => nameLower.includes(kw));
  });

  // Check set types
  const exercisesWithSets = nonSkipped.filter((e) => e.sets.length > 0);
  const allTimed =
    exercisesWithSets.length > 0 &&
    exercisesWithSets.every((e) =>
      e.sets.every(
        (s) => s.durationSeconds !== undefined && s.reps === undefined,
      ),
    );
  const hasWeighted = nonSkipped.some((e) =>
    e.sets.some((s) => s.reps !== undefined && s.weight !== undefined && s.weight > 0),
  );

  if (hasCardio && !hasWeighted && !allTimed) return "cardio";
  if (allTimed && !hasCardio && !hasWeighted) return "calisthenics";
  if (hasWeighted) {
    if (hasCardio || allTimed) return "mixed";
    return "weightlifting";
  }
  if (hasCardio) return "cardio";

  return "weightlifting";
}
