import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExerciseResolution, FuzzyMatchResult } from "@src/api/lib/index";

export type ExerciseCategory =
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "legs"
  | "core"
  | "cardio"
  | "other";

export type ExerciseType =
  | "weightlifting"
  | "hiit"
  | "cardio"
  | "calisthenics"
  | "yoga"
  | "sports"
  | "mixed";

export type Resolution =
  | { type: "existing"; exerciseId: string; exerciseName: string }
  | {
      type: "create";
      name: string;
      category: ExerciseCategory;
      exerciseType: ExerciseType;
    }
  | { type: "skip" };

interface ResolveStepProps {
  exerciseNames: string[];
  duplicateDates: string[];
  onComplete: (resolutionMap: Record<string, Resolution>) => void;
  onBack: () => void;
}

const CATEGORIES = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "cardio",
  "other",
] as const;

const EXERCISE_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

// Per-exercise resolution row
function ExerciseRow({
  resolution,
  userResolution,
  onChange,
}: {
  resolution: ExerciseResolution;
  userResolution: Resolution | undefined;
  onChange: (r: Resolution) => void;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState(resolution.parsedName);
  const [createCategory, setCreateCategory] = useState<ExerciseCategory>("other");
  const [createType, setCreateType] = useState<ExerciseType>("weightlifting");
  const [searchQuery, setSearchQuery] = useState("");

  const isResolved = userResolution !== undefined;
  const isSkipped = userResolution?.type === "skip";

  const filteredMatches = resolution.matches.filter((m) =>
    m.exerciseName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSelectExisting = (match: FuzzyMatchResult) => {
    onChange({ type: "existing", exerciseId: match.exerciseId, exerciseName: match.exerciseName });
    setShowCreateForm(false);
  };

  const handleCreateNew = () => {
    if (!createName.trim()) return;
    onChange({
      type: "create",
      name: createName.trim(),
      category: createCategory,
      exerciseType: createType,
    });
    setShowCreateForm(false);
  };

  const confidenceBadge = {
    high: (
      <Badge variant="default" className="bg-green-600 text-white text-xs">
        <Check className="size-3 mr-0.5" /> Auto-matched
      </Badge>
    ),
    low: (
      <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">
        Low confidence
      </Badge>
    ),
    none: (
      <Badge variant="destructive" className="text-xs">
        <X className="size-3 mr-0.5" /> No match
      </Badge>
    ),
  }[resolution.confidence];

  return (
    <div
      className={[
        "border rounded-none p-3 space-y-2",
        isResolved && !isSkipped
          ? "border-green-500/30 bg-green-50/10"
          : isSkipped
            ? "opacity-50"
            : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{resolution.parsedName}</p>
          {userResolution?.type === "existing" && (
            <p className="text-xs text-green-600">
              Mapped to: {userResolution.exerciseName}
            </p>
          )}
          {userResolution?.type === "create" && (
            <p className="text-xs text-blue-600">
              Will create: {userResolution.name}
            </p>
          )}
          {userResolution?.type === "skip" && (
            <p className="text-xs text-muted-foreground">Skipped</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {confidenceBadge}
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ type: "skip" })}
          >
            Skip
          </Button>
        </div>
      </div>

      {/* Auto-matched high confidence -- show the match and allow changing */}
      {resolution.confidence === "high" && !userResolution && resolution.bestMatch && (
        <div className="text-xs text-muted-foreground">
          Will map to:{" "}
          <span className="font-medium text-foreground">
            {resolution.bestMatch.exerciseName}
          </span>{" "}
          ({Math.round(resolution.bestMatch.score)}% match)
          <button
            className="ml-2 underline underline-offset-2"
            onClick={() => {
              // User wants to change -- apply best match first so they can see it, but open the picker
              setSearchQuery("");
            }}
          >
            change
          </button>
        </div>
      )}

      {/* Suggestions for low/no confidence or manual override */}
      {(resolution.confidence !== "high" || isSkipped) && !showCreateForm && !isResolved && (
        <div className="space-y-2">
          {resolution.matches.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Suggestions:</p>
              {resolution.matches.slice(0, 5).map((match) => (
                <button
                  key={match.exerciseId}
                  className="w-full text-left text-xs border rounded-none px-2 py-1 hover:bg-muted/50 flex items-center justify-between"
                  onClick={() => handleSelectExisting(match)}
                >
                  <span>{match.exerciseName}</span>
                  <span className="text-muted-foreground ml-2">
                    {Math.round(match.score)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Search input for finding exercises */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Search exercise library:
            </p>
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 text-xs"
            />
            {searchQuery && (
              <div className="max-h-32 overflow-y-auto space-y-0.5 border rounded-none">
                {filteredMatches.length > 0 ? (
                  filteredMatches.map((match) => (
                    <button
                      key={match.exerciseId}
                      className="w-full text-left text-xs px-2 py-1 hover:bg-muted/50 flex items-center justify-between"
                      onClick={() => handleSelectExisting(match)}
                    >
                      <span>{match.exerciseName}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground px-2 py-1">
                    No matches found
                  </p>
                )}
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowCreateForm(true)}
          >
            Create New Exercise
          </Button>
        </div>
      )}

      {/* Create new exercise form */}
      {showCreateForm && (
        <div className="space-y-2 border rounded-none p-2">
          <p className="text-xs font-medium">Create New Exercise</p>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={createCategory}
                onValueChange={(v) => {
                  if (v) setCreateCategory(v as ExerciseCategory);
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select
                value={createType}
                onValueChange={(v) => {
                  if (v) setCreateType(v as ExerciseType);
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXERCISE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={handleCreateNew}>
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowCreateForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsible section
function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <button
        className="flex items-center justify-between w-full text-sm font-medium"
        onClick={() => setOpen(!open)}
      >
        <span>
          {title} ({count})
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

export function ResolveStep({
  exerciseNames,
  duplicateDates,
  onComplete,
  onBack,
}: ResolveStepProps) {
  const { data: resolutions, isLoading } = useQuery(
    trpc.import.resolveExercises.queryOptions({ exerciseNames }),
  );

  const [resolutionMap, setResolutionMap] = useState<Record<string, Resolution>>(
    {},
  );

  if (isLoading || !resolutions) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Resolving Exercises...</h2>
        <p className="text-muted-foreground text-sm">
          Matching exercise names against the library.
        </p>
      </div>
    );
  }

  const setResolution = (parsedName: string, r: Resolution) => {
    setResolutionMap((prev) => ({ ...prev, [parsedName]: r }));
  };

  // Compute effective resolution for each exercise
  const effectiveResolution = (r: ExerciseResolution): Resolution | undefined => {
    const user = resolutionMap[r.parsedName];
    if (user) return user;
    // Auto-apply high-confidence matches
    if (r.confidence === "high" && r.bestMatch) {
      return {
        type: "existing",
        exerciseId: r.bestMatch.exerciseId,
        exerciseName: r.bestMatch.exerciseName,
      };
    }
    return undefined;
  };

  const high = resolutions.filter((r) => r.confidence === "high");
  const low = resolutions.filter((r) => r.confidence === "low");
  const none = resolutions.filter((r) => r.confidence === "none");

  // Count resolved: high confidence are auto-resolved unless user overrides with skip
  const resolvedCount = resolutions.filter((r) => {
    const eff = effectiveResolution(r);
    return eff !== undefined;
  }).length;

  const allResolved = resolvedCount === resolutions.length;

  const buildFinalMap = (): Record<string, Resolution> => {
    const map: Record<string, Resolution> = {};
    for (const r of resolutions) {
      const eff = effectiveResolution(r);
      if (eff) {
        map[r.parsedName] = eff;
      } else {
        // Default unresolved to skip
        map[r.parsedName] = { type: "skip" };
      }
    }
    return map;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Resolve Exercises</h2>
        <p className="text-muted-foreground text-sm">
          Match parsed exercise names to your exercise library. High-confidence
          matches are auto-selected.
        </p>
      </div>

      {duplicateDates.length > 0 && (
        <Card className="border-yellow-400/50">
          <CardContent className="py-3">
            <p className="text-sm text-yellow-600">
              {duplicateDates.length} workout date
              {duplicateDates.length > 1 ? "s" : ""} already exist in your log.
              You can skip or import them in the next step.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <Section
          title="High Confidence Matches"
          count={high.length}
          defaultOpen={false}
        >
          {high.map((r) => (
            <ExerciseRow
              key={r.parsedName}
              resolution={r}
              userResolution={resolutionMap[r.parsedName]}
              onChange={(res) => setResolution(r.parsedName, res)}
            />
          ))}
        </Section>

        <Section
          title="Low Confidence Matches"
          count={low.length}
          defaultOpen={true}
        >
          {low.map((r) => (
            <ExerciseRow
              key={r.parsedName}
              resolution={r}
              userResolution={resolutionMap[r.parsedName]}
              onChange={(res) => setResolution(r.parsedName, res)}
            />
          ))}
        </Section>

        <Section title="No Match Found" count={none.length} defaultOpen={true}>
          {none.map((r) => (
            <ExerciseRow
              key={r.parsedName}
              resolution={r}
              userResolution={resolutionMap[r.parsedName]}
              onChange={(res) => setResolution(r.parsedName, res)}
            />
          ))}
        </Section>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="py-3">
          <p className="text-sm">
            <span className="font-semibold">{resolvedCount}</span> of{" "}
            <span className="font-semibold">{resolutions.length}</span>{" "}
            exercises resolved
            {!allResolved && (
              <span className="text-muted-foreground ml-1">
                — unresolved exercises will be skipped
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={() => onComplete(buildFinalMap())}>
          Next: Preview
        </Button>
      </div>
    </div>
  );
}
