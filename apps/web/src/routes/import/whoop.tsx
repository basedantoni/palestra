import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckSquare, Square, Zap } from "lucide-react";
import { format } from "date-fns";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/index";

export const Route = createFileRoute("/import/whoop")({
  component: WhoopImportPage,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );
    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }
    return { session };
  },
});

type WorkoutType = "weightlifting" | "hiit" | "cardio" | "calisthenics" | "yoga" | "sports" | "mixed";

type WhoopActivity = {
  id: string;
  whoopActivityId: string;
  start: string;
  end: string;
  sportId: number;
  sportName: string;
  workoutType: WorkoutType;
  durationMinutes: number;
  strain: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  alreadyImported: boolean;
};

type Step = "select" | "review" | "complete";

type CommitResult = {
  createdCount: number;
  skippedCount: number;
};

function WhoopImportPage() {
  const [step, setStep] = useState<Step>("select");
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  // Connection check
  const connectionQuery = useQuery(trpc.whoop.connectionStatus.queryOptions());

  // Date range filter state
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Applied filter (only applied when user clicks filter or from initial load)
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  // Pagination: accumulated list of activities across pages
  const [allActivities, setAllActivities] = useState<WhoopActivity[]>([]);
  const [nextToken, setNextToken] = useState<string | null | undefined>(undefined); // undefined = not yet loaded
  const [currentToken, setCurrentToken] = useState<string | undefined>(undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Track which filter was applied to current activity list
  const appliedFilterRef = useRef({ from: "", to: "" });

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false); // "select all in date range" flag

  // Review step: per-activity type overrides
  const [typeOverrides, setTypeOverrides] = useState<Record<string, WorkoutType>>({});

  // First page query — controlled by appliedFrom/appliedTo
  const firstPageQuery = useQuery({
    ...trpc.whoop.listActivities.queryOptions({
      from: appliedFrom || undefined,
      to: appliedTo || undefined,
      limit: 25,
    }),
    enabled:
      connectionQuery.data?.connected === true &&
      connectionQuery.data?.isValid === true,
    retry: false,
  });

  // Reset accumulated state when filter changes
  useEffect(() => {
    const prevFilter = appliedFilterRef.current;
    if (prevFilter.from !== appliedFrom || prevFilter.to !== appliedTo) {
      appliedFilterRef.current = { from: appliedFrom, to: appliedTo };
      setAllActivities([]);
      setNextToken(undefined);
      setCurrentToken(undefined);
      setSelectedIds(new Set());
      setSelectAll(false);
      setLoadMoreError(null);
    }
  }, [appliedFrom, appliedTo]);

  // Sync first page results into allActivities
  useEffect(() => {
    if (firstPageQuery.data) {
      setAllActivities(firstPageQuery.data.activities as WhoopActivity[]);
      setNextToken(firstPageQuery.data.nextToken);
    }
  }, [firstPageQuery.data]);

  // Subsequent page query — only fires when currentToken is set
  const nextPageQuery = useQuery({
    ...trpc.whoop.listActivities.queryOptions({
      from: appliedFrom || undefined,
      to: appliedTo || undefined,
      nextToken: currentToken,
      limit: 25,
    }),
    enabled:
      currentToken !== undefined &&
      connectionQuery.data?.connected === true &&
      connectionQuery.data?.isValid === true,
    retry: false,
  });

  // Append next page results to accumulated list when they arrive
  useEffect(() => {
    if (nextPageQuery.data && currentToken !== undefined) {
      setAllActivities((prev) => {
        // Deduplicate by id in case of re-render
        const existingIds = new Set(prev.map((a) => a.whoopActivityId));
        const newActivities = (nextPageQuery.data.activities as WhoopActivity[]).filter(
          (a) => !existingIds.has(a.whoopActivityId),
        );
        return [...prev, ...newActivities];
      });
      setNextToken(nextPageQuery.data.nextToken);
      setIsLoadingMore(false);
      setCurrentToken(undefined); // Reset so query becomes disabled
    }
  }, [nextPageQuery.data, currentToken]);

  useEffect(() => {
    if (nextPageQuery.isError && currentToken !== undefined) {
      setLoadMoreError(
        nextPageQuery.error instanceof Error
          ? nextPageQuery.error.message
          : "Failed to load more activities",
      );
      setIsLoadingMore(false);
      setCurrentToken(undefined);
    }
  }, [nextPageQuery.isError, nextPageQuery.error, currentToken]);

  const handleLoadMore = useCallback(() => {
    if (nextToken && !isLoadingMore) {
      setIsLoadingMore(true);
      setLoadMoreError(null);
      setCurrentToken(nextToken);
    }
  }, [nextToken, isLoadingMore]);

  const handleApplyFilter = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
  };

  const handleClearFilter = () => {
    setFromDate("");
    setToDate("");
    setAppliedFrom("");
    setAppliedTo("");
  };

  // Selection handlers
  const toggleActivity = (id: string) => {
    if (selectAll) {
      // When in selectAll mode, switching to individual selection
      setSelectAll(false);
      const newSet = new Set(allActivities.map((a) => a.whoopActivityId));
      newSet.delete(id);
      setSelectedIds(newSet);
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      // Deselect all
      setSelectAll(false);
      setSelectedIds(new Set());
    } else {
      // Select all loaded
      setSelectAll(false);
      setSelectedIds(new Set(allActivities.map((a) => a.whoopActivityId)));
    }
  };

  const handleSelectAllInRange = () => {
    if (selectAll) {
      // Already in selectAll mode, deactivate
      setSelectAll(false);
      setSelectedIds(new Set());
    } else {
      // Activate selectAll mode
      setSelectAll(true);
      setSelectedIds(new Set(allActivities.map((a) => a.whoopActivityId)));
    }
  };

  const handleProceedToReview = () => {
    // Pre-populate overrides with the default workoutType per selected activity
    const initialOverrides: Record<string, WorkoutType> = {};
    if (!selectAll) {
      for (const activity of allActivities) {
        if (selectedIds.has(activity.whoopActivityId)) {
          initialOverrides[activity.whoopActivityId] = activity.workoutType;
        }
      }
    } else {
      for (const activity of allActivities) {
        initialOverrides[activity.whoopActivityId] = activity.workoutType;
      }
    }
    setTypeOverrides(initialOverrides);
    setStep("review");
  };

  // Loading states
  if (connectionQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-6">
        <div className="text-sm text-muted-foreground">Checking Whoop connection...</div>
      </div>
    );
  }

  // Not connected or invalid
  if (
    !connectionQuery.data?.connected ||
    !connectionQuery.data?.isValid
  ) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4">
          <Link to="/import" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Import
          </Link>
        </div>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Zap className="mx-auto h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Whoop Not Connected</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {connectionQuery.data?.connected && !connectionQuery.data?.isValid
                  ? "Your Whoop connection has expired. Please reconnect to import activities."
                  : "Connect your Whoop account to import workout activities."}
              </p>
            </div>
            <Link to="/settings">
              <Button>Go to Settings to Connect</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render the current step
  if (step === "review") {
    const selectedActivities = selectAll
      ? allActivities
      : allActivities.filter((a) => selectedIds.has(a.whoopActivityId));

    return (
      <ReviewStep
        selectedActivities={selectedActivities}
        selectAll={selectAll}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        typeOverrides={typeOverrides}
        onTypeOverrideChange={(id, type) =>
          setTypeOverrides((prev) => ({ ...prev, [id]: type }))
        }
        onBack={() => setStep("select")}
        onComplete={(result) => {
          setCommitResult(result);
          setStep("complete");
        }}
      />
    );
  }

  if (step === "complete") {
    return (
      <CompleteStep
        result={commitResult!}
        onStartOver={() => {
          setStep("select");
          setSelectedIds(new Set());
          setSelectAll(false);
          setCommitResult(null);
        }}
      />
    );
  }

  // Select step
  const isFirstPageLoading = firstPageQuery.isLoading;
  const isFirstPageError = firstPageQuery.isError;

  const allLoadedCount = allActivities.length;
  const selectedCount = selectAll
    ? "all in range"
    : selectedIds.size;

  const hasMore = nextToken !== null && nextToken !== undefined && allActivities.length > 0;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-4">
        <Link to="/import" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Import
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Import from Whoop</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select Whoop workout activities to import.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs text-muted-foreground">
        <span className="text-foreground font-medium">Select</span>
        <span className="text-border">›</span>
        <span>Review</span>
        <span className="text-border">›</span>
        <span>Complete</span>
      </div>

      {/* Date filter */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Filter by Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="from-date" className="text-xs">From</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to-date" className="text-xs">To</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleApplyFilter}>
              Apply Filter
            </Button>
            {(appliedFrom || appliedTo) && (
              <Button size="sm" variant="outline" onClick={handleClearFilter}>
                Clear Filter
              </Button>
            )}
          </div>
          {(appliedFrom || appliedTo) && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing activities
              {appliedFrom ? ` from ${format(new Date(appliedFrom), "MMM d, yyyy")}` : ""}
              {appliedTo ? ` to ${format(new Date(appliedTo), "MMM d, yyyy")}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {isFirstPageLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Loading activities from Whoop...
        </div>
      )}

      {/* Error state */}
      {isFirstPageError && (
        <Card className="border-destructive mb-4">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">
                {firstPageQuery.error instanceof Error
                  ? firstPageQuery.error.message
                  : "Failed to load Whoop activities"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity list */}
      {!isFirstPageLoading && !isFirstPageError && (
        <>
          {allActivities.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No activities found for the selected date range.
            </div>
          ) : (
            <>
              {/* Selection controls */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectAll}
                  className="text-xs gap-1"
                >
                  {selectedIds.size === allLoadedCount && !selectAll && allLoadedCount > 0 ? (
                    <>
                      <CheckSquare className="h-3.5 w-3.5" />
                      Deselect All Loaded
                    </>
                  ) : (
                    <>
                      <Square className="h-3.5 w-3.5" />
                      Select All Loaded ({allLoadedCount})
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant={selectAll ? "default" : "outline"}
                  onClick={handleSelectAllInRange}
                  className="text-xs"
                >
                  {selectAll ? "Deselect All in Range" : "Select All in Date Range"}
                </Button>
                {(selectAll ? true : selectedIds.size > 0) && (
                  <span className="text-xs text-muted-foreground">
                    {typeof selectedCount === "string"
                      ? `All in date range selected`
                      : `${selectedCount} selected`}
                  </span>
                )}
              </div>

              {selectAll && (
                <div className="text-xs text-blue-600 dark:text-blue-400 mb-3 p-2 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
                  All activities in the current date range will be imported — including pages not yet loaded.
                </div>
              )}

              {/* Activity rows */}
              <div className="space-y-2 mb-4">
                {allActivities.map((activity) => {
                  const isSelected = selectAll || selectedIds.has(activity.whoopActivityId);
                  return (
                    <ActivityRow
                      key={activity.whoopActivityId}
                      activity={activity}
                      isSelected={isSelected}
                      onToggle={() => toggleActivity(activity.whoopActivityId)}
                    />
                  );
                })}
              </div>

              {/* Load more error (doesn't clear already-loaded activities) */}
              {loadMoreError && (
                <div className="flex items-center gap-2 text-destructive text-sm mb-3">
                  <AlertCircle className="h-4 w-4" />
                  <span>{loadMoreError} — previously loaded activities are still shown above.</span>
                </div>
              )}

              {/* Load more button */}
              {hasMore && (
                <div className="flex justify-center mb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? "Loading..." : "Load More Activities"}
                  </Button>
                </div>
              )}

              {!hasMore && allActivities.length > 0 && (
                <p className="text-xs text-muted-foreground text-center mb-4">
                  All {allLoadedCount} activities loaded.
                </p>
              )}
            </>
          )}

          {/* Next step button */}
          <div className="flex justify-end mt-4">
            <Button
              disabled={!selectAll && selectedIds.size === 0}
              onClick={handleProceedToReview}
            >
              Next: Review
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Activity Row (Select step) ──────────────────────────────────────────────

interface ActivityRowProps {
  activity: WhoopActivity;
  isSelected: boolean;
  onToggle: () => void;
}

function ActivityRow({ activity, isSelected, onToggle }: ActivityRowProps) {
  const startDate = new Date(activity.start);

  return (
    <div
      className={[
        "flex items-start gap-3 border p-3 cursor-pointer transition-colors",
        isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/30",
        activity.alreadyImported ? "opacity-60" : "",
      ].join(" ")}
      onClick={onToggle}
    >
      <div className="mt-0.5 flex-shrink-0">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{activity.sportName}</span>
          {activity.alreadyImported && (
            <Badge variant="secondary" className="text-xs">Already imported</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
          <span>{format(startDate, "MMM d, yyyy 'at' h:mm a")}</span>
          <span>{activity.durationMinutes} min</span>
          {activity.strain !== null && (
            <span>Strain: {activity.strain.toFixed(1)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Review Step ─────────────────────────────────────────────────────────────

const WORKOUT_TYPES: WorkoutType[] = [
  "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
];

interface ReviewStepProps {
  selectedActivities: WhoopActivity[];
  selectAll: boolean;
  appliedFrom: string;
  appliedTo: string;
  typeOverrides: Record<string, WorkoutType>;
  onTypeOverrideChange: (id: string, type: WorkoutType) => void;
  onBack: () => void;
  onComplete: (result: CommitResult) => void;
}

function ReviewStep({
  selectedActivities,
  selectAll,
  appliedFrom,
  appliedTo,
  typeOverrides,
  onTypeOverrideChange,
  onBack,
  onComplete,
}: ReviewStepProps) {
  const queryClient = useQueryClient();

  const commitMutation = useMutation(
    trpc.whoop.commit.mutationOptions({
      onSuccess: (data) => {
        // Invalidate workout and whoop queries so lists/detail views refresh
        void queryClient.invalidateQueries({
          queryKey: trpc.workouts.listWithSummary.queryOptions().queryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.workouts.list.queryOptions().queryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.whoop.connectionStatus.queryOptions().queryKey,
        });
        // Invalidate all calendarRange queries (any date range)
        void queryClient.invalidateQueries({
          queryKey: [["workouts", "calendarRange"]],
        });
        onComplete(data);
      },
    }),
  );

  const handleCommit = () => {
    if (selectAll) {
      commitMutation.mutate({
        selectAll: true,
        from: appliedFrom || undefined,
        to: appliedTo || undefined,
        typeOverrides,
      });
    } else {
      commitMutation.mutate({
        selectAll: false,
        activityIds: selectedActivities.map((a) => a.whoopActivityId),
        typeOverrides,
        from: appliedFrom || undefined,
        to: appliedTo || undefined,
      });
    }
  };

  // Helper: build the auto-generated notes for preview
  const buildNotes = (activity: WhoopActivity): string => {
    const parts = [`Imported from Whoop. Sport: ${activity.sportName}.`];
    if (activity.strain !== null) parts.push(`Strain: ${activity.strain.toFixed(1)}.`);
    if (activity.averageHeartRate !== null) parts.push(`Avg HR: ${activity.averageHeartRate} bpm.`);
    return parts.join(" ");
  };

  const buildIntensity = (activity: WhoopActivity): number | null => {
    if (activity.strain === null) return null;
    return Math.round(Math.min(10, Math.max(0, activity.strain)) * 10);
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Select
        </button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Review Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {selectAll
            ? "All activities in the selected date range will be imported. Adjust workout types below for loaded activities — overrides apply to all."
            : `Review ${selectedActivities.length} selected ${selectedActivities.length === 1 ? "activity" : "activities"} before importing.`}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs text-muted-foreground">
        <span>Select</span>
        <span className="text-border">›</span>
        <span className="text-foreground font-medium">Review</span>
        <span className="text-border">›</span>
        <span>Complete</span>
      </div>

      {selectAll && (
        <div className="text-xs text-blue-600 dark:text-blue-400 mb-4 p-2 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
          Showing loaded activities only. All activities in the date range (including unloaded pages) will be imported.
        </div>
      )}

      {/* Activity review cards */}
      <div className="space-y-3 mb-6">
        {selectedActivities.map((activity) => {
          const effectiveType = typeOverrides[activity.whoopActivityId] ?? activity.workoutType;
          const intensity = buildIntensity(activity);
          const notes = buildNotes(activity);

          return (
            <Card key={activity.whoopActivityId}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{activity.sportName}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(activity.start), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                  {activity.alreadyImported && (
                    <Badge variant="secondary" className="text-xs shrink-0">Already imported — will skip</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Fields preview */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="text-muted-foreground">Duration</div>
                  <div>{activity.durationMinutes} min</div>

                  {activity.averageHeartRate !== null && (
                    <>
                      <div className="text-muted-foreground">Avg Heart Rate</div>
                      <div>{activity.averageHeartRate} bpm</div>
                    </>
                  )}

                  {activity.strain !== null && (
                    <>
                      <div className="text-muted-foreground">Strain (Whoop)</div>
                      <div>{activity.strain.toFixed(1)} / 21</div>
                    </>
                  )}

                  {intensity !== null && (
                    <>
                      <div className="text-muted-foreground">Intensity (0–100)</div>
                      <div>{intensity}</div>
                    </>
                  )}
                </div>

                {/* Notes preview */}
                <div className="text-xs text-muted-foreground border-t pt-2">
                  <span className="font-medium text-foreground">Notes: </span>
                  {notes}
                </div>

                {/* Workout type override */}
                <div className="flex items-center gap-2 border-t pt-2">
                  <Label className="text-xs shrink-0">Workout Type</Label>
                  <select
                    className="flex-1 rounded border bg-background px-2 py-1 text-xs"
                    value={effectiveType}
                    onChange={(e) =>
                      onTypeOverrideChange(
                        activity.whoopActivityId,
                        e.target.value as WorkoutType,
                      )
                    }
                  >
                    {WORKOUT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {WORKOUT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Error */}
      {commitMutation.isError && (
        <div className="flex items-center gap-2 text-destructive text-sm mb-4">
          <AlertCircle className="h-4 w-4" />
          <span>
            {commitMutation.error instanceof Error
              ? commitMutation.error.message
              : "Import failed. Please try again."}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={commitMutation.isPending}>
          Back
        </Button>
        <Button onClick={handleCommit} disabled={commitMutation.isPending}>
          {commitMutation.isPending ? "Importing..." : "Commit Import"}
        </Button>
      </div>
    </div>
  );
}

// ─── Complete Step ────────────────────────────────────────────────────────────

interface CompleteStepProps {
  result: CommitResult;
  onStartOver: () => void;
}

function CompleteStep({ result, onStartOver }: CompleteStepProps) {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs text-muted-foreground">
        <span>Select</span>
        <span className="text-border">›</span>
        <span>Review</span>
        <span className="text-border">›</span>
        <span className="text-foreground font-medium">Complete</span>
      </div>

      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <div className="text-4xl">✓</div>
          <div>
            <h2 className="text-xl font-semibold">Import Complete</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Your Whoop activities have been imported.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto mt-4">
            <div className="text-center border rounded p-3">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {result.createdCount}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Created</div>
            </div>
            <div className="text-center border rounded p-3">
              <div className="text-2xl font-bold text-muted-foreground">
                {result.skippedCount}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Skipped (already imported)</div>
            </div>
          </div>

          <div className="flex gap-3 justify-center pt-2">
            <Link to="/workouts">
              <Button>View Workouts</Button>
            </Link>
            <Button variant="outline" onClick={onStartOver}>
              Import More
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
