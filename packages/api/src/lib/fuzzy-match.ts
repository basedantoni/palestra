export interface FuzzyMatchResult {
  exerciseId: string;
  exerciseName: string;
  score: number; // 0-100, where 100 = exact match
  category: string;
  exerciseType: string;
}

export interface ExerciseResolution {
  parsedName: string;
  matches: FuzzyMatchResult[]; // top 5 matches, sorted by score descending
  bestMatch: FuzzyMatchResult | null; // highest score, or null if no match > 30
  confidence: "high" | "low" | "none";
  // high = best match score >= 80
  // low  = best match score >= 50 and < 80
  // none = best match score < 50 or no matches
  similarTo: string[]; // other parsed names in this batch with cross-batch score >= 60
}

// ---- Helpers ----

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] =
          1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

/**
 * Compute similarity score (0-100) between two exercise names.
 *
 * Strategy (combined scoring):
 * 1. Normalize both strings: lowercase, trim, remove punctuation, collapse whitespace
 * 2. Token overlap score (Jaccard): |intersection| / |union| of word tokens * 100
 * 3. Substring containment bonus: if one normalized name contains the other, add 20 points
 * 4. Levenshtein distance score: only applied to short names (< 3 tokens).
 *    score = max(0, 100 - (levenshtein / maxLen * 100))
 * 5. Final score = min(100, max(tokenScore + containmentBonus, levenshteinScore))
 */
export function computeSimilarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  // Exact match after normalization
  if (normA === normB) return 100;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  // Token overlap (Jaccard similarity)
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  const tokenScore = union.size === 0 ? 0 : (intersection.size / union.size) * 100;

  // Substring containment bonus
  const containmentBonus =
    normA.includes(normB) || normB.includes(normA) ? 20 : 0;

  // Levenshtein score (only for short names)
  const maxTokens = Math.max(tokensA.length, tokensB.length);
  let levenshteinScore = 0;
  if (maxTokens < 3) {
    const maxLen = Math.max(normA.length, normB.length);
    const dist = levenshtein(normA, normB);
    levenshteinScore = Math.max(0, 100 - (dist / maxLen) * 100);
  }

  return Math.min(100, Math.max(tokenScore + containmentBonus, levenshteinScore));
}

/**
 * Given a list of parsed exercise names and the full exercise library,
 * return resolution suggestions for each name.
 */
export function resolveExerciseNames(
  parsedNames: string[],
  exerciseLibrary: {
    id: string;
    name: string;
    category: string;
    exerciseType: string;
  }[],
): ExerciseResolution[] {
  const resolutions: ExerciseResolution[] = parsedNames.map((parsedName) => {
    const scored: FuzzyMatchResult[] = exerciseLibrary.map((ex) => ({
      exerciseId: ex.id,
      exerciseName: ex.name,
      score: computeSimilarity(parsedName, ex.name),
      category: ex.category,
      exerciseType: ex.exerciseType,
    }));

    // Sort descending by score, take top 5 with score > 30
    const top5 = scored
      .filter((r) => r.score > 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const bestMatch = top5.length > 0 ? top5[0]! : null;
    const bestScore = bestMatch?.score ?? 0;

    let confidence: ExerciseResolution["confidence"];
    if (bestScore >= 80) {
      confidence = "high";
    } else if (bestScore >= 50) {
      confidence = "low";
    } else {
      confidence = "none";
    }

    return {
      parsedName,
      matches: top5,
      bestMatch: bestScore >= 50 ? bestMatch : null,
      confidence,
      similarTo: [],
    };
  });

  // Cross-batch pairwise similarity
  const CROSS_BATCH_THRESHOLD = 60;
  for (let i = 0; i < resolutions.length; i++) {
    const similarNames: string[] = [];
    for (let j = 0; j < resolutions.length; j++) {
      if (i === j) continue;
      const score = computeSimilarity(
        resolutions[i]!.parsedName,
        resolutions[j]!.parsedName,
      );
      if (score >= CROSS_BATCH_THRESHOLD) {
        similarNames.push(resolutions[j]!.parsedName);
      }
    }
    resolutions[i]!.similarTo = similarNames;
  }

  return resolutions;
}
