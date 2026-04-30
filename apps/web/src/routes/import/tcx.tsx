import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  CheckSquare,
  FolderOpen,
  Square,
  Upload,
} from "lucide-react";
import { format } from "date-fns";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { parseTcxRun, type ParsedTcxRun } from "@src/api/lib/tcx-import";

export const Route = createFileRoute("/import/tcx")({
  component: TcxImportPage,
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

const DEFAULT_SOURCE = "nike_run_club";
const SOURCE_LABELS: Record<string, string> = {
  nike_run_club: "Nike Run Club",
};

type Step = "select" | "review" | "complete";

type ParseWarning = {
  fileName: string;
  message: string;
};

type PreviewRun = ParsedTcxRun & {
  fingerprint: string;
  isDuplicate: boolean;
  exerciseName: "Short Run" | "Long Run";
};

type PreviewResult = {
  source: string;
  totalCount: number;
  duplicateCount: number;
  newCount: number;
  skippedInvalidCount: number;
  runs: PreviewRun[];
};

type CommitResult = {
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  totalCount: number;
};

type FileWithPath = File & {
  webkitRelativePath?: string;
};

function formatDistanceMeters(distanceMeter: number): string {
  return `${(distanceMeter / 1000).toFixed(2)} km`;
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
}

function getFileDisplayName(file: FileWithPath): string {
  return file.webkitRelativePath || file.name;
}

function TcxImportPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("select");
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [parsedRuns, setParsedRuns] = useState<ParsedTcxRun[]>([]);
  const [parseWarnings, setParseWarnings] = useState<ParseWarning[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedFingerprints, setSelectedFingerprints] = useState<Set<string>>(
    () => new Set(),
  );
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const previewMutation = useMutation(
    trpc.tcxImport.preview.mutationOptions({
      onSuccess: (data) => {
        const result = data as PreviewResult;
        setPreview(result);
        setSelectedFingerprints(
          new Set(
            result.runs
              .filter((run) => !run.isDuplicate)
              .map((run) => run.fingerprint),
          ),
        );
        setStep("review");
      },
    }),
  );

  const commitMutation = useMutation(
    trpc.tcxImport.commit.mutationOptions({
      onSuccess: (data) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.workouts.listWithSummary.queryOptions().queryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.workouts.list.queryOptions().queryKey,
        });
        void queryClient.invalidateQueries({
          queryKey: [["workouts", "calendarRange"]],
        });
        setCommitResult(data as CommitResult);
        setStep("complete");
      },
    }),
  );

  const selectedRuns = useMemo(() => {
    if (!preview) return [];
    return preview.runs.filter(
      (run) => !run.isDuplicate && selectedFingerprints.has(run.fingerprint),
    );
  }, [preview, selectedFingerprints]);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []) as FileWithPath[];
    const tcxFiles = files
      .filter((file) => file.name.toLowerCase().endsWith(".tcx"))
      .sort((a, b) => getFileDisplayName(a).localeCompare(getFileDisplayName(b)));

    setParseError(null);
    setParseWarnings([]);
    setParsedRuns([]);
    setPreview(null);
    setSelectedFingerprints(new Set());
    setCommitResult(null);

    if (tcxFiles.length === 0) {
      setParseError("No .tcx files found in the selected folder.");
      return;
    }

    setIsParsing(true);

    try {
      const runs: ParsedTcxRun[] = [];
      const warnings: ParseWarning[] = [];

      for (const file of tcxFiles) {
        const fileName = getFileDisplayName(file);
        try {
          const xml = await file.text();
          const run = parseTcxRun(fileName, xml);
          if (run) {
            runs.push(run);
          } else {
            warnings.push({
              fileName,
              message: "No running activity found",
            });
          }
        } catch (err) {
          warnings.push({
            fileName,
            message:
              err instanceof Error ? err.message : "Failed to read TCX file",
          });
        }
      }

      setParsedRuns(runs);
      setParseWarnings(warnings);

      if (runs.length === 0) {
        setParseError("No running activities were parsed from the selected folder.");
        return;
      }

      previewMutation.mutate({ source, runs });
    } finally {
      setIsParsing(false);
    }
  };

  const reset = () => {
    setStep("select");
    setParsedRuns([]);
    setParseWarnings([]);
    setPreview(null);
    setSelectedFingerprints(new Set());
    setCommitResult(null);
    setParseError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toggleRun = (run: PreviewRun) => {
    if (run.isDuplicate) return;
    setSelectedFingerprints((previous) => {
      const next = new Set(previous);
      if (next.has(run.fingerprint)) {
        next.delete(run.fingerprint);
      } else {
        next.add(run.fingerprint);
      }
      return next;
    });
  };

  const selectAllNew = () => {
    if (!preview) return;
    setSelectedFingerprints(
      new Set(
        preview.runs
          .filter((run) => !run.isDuplicate)
          .map((run) => run.fingerprint),
      ),
    );
  };

  const clearSelection = () => {
    setSelectedFingerprints(new Set());
  };

  const commitSelected = () => {
    if (!preview || selectedFingerprints.size === 0) return;
    commitMutation.mutate({
      source: preview.source,
      runs: parsedRuns,
      selectedFingerprints: Array.from(selectedFingerprints),
    });
  };

  if (step === "complete" && commitResult) {
    return <CompleteStep result={commitResult} onStartOver={reset} />;
  }

  if (step === "review" && preview) {
    return (
      <ReviewStep
        preview={preview}
        selectedCount={selectedRuns.length}
        selectedFingerprints={selectedFingerprints}
        parseWarnings={parseWarnings}
        isCommitting={commitMutation.isPending}
        commitError={
          commitMutation.error instanceof Error
            ? commitMutation.error.message
            : null
        }
        onBack={() => setStep("select")}
        onToggleRun={toggleRun}
        onSelectAllNew={selectAllNew}
        onClearSelection={clearSelection}
        onCommit={commitSelected}
      />
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link
          to="/import"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Import
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Import TCX Files</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a folder of TCX running activities.
        </p>
      </div>

      <StepIndicator active="select" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">TCX Folder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <div className="space-y-1">
              <Label htmlFor="tcx-source" className="text-xs">
                Source
              </Label>
              <select
                id="tcx-source"
                className="border-input bg-background h-8 w-full rounded-none border px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="nike_run_club">Nike Run Club</option>
              </select>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".tcx"
                multiple
                className="hidden"
                onChange={(event) => void handleFiles(event.target.files)}
                {...{ webkitdirectory: "", directory: "" }}
              />
              <button
                type="button"
                className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                onClick={() => fileInputRef.current?.click()}
              >
              <FolderOpen className="mb-3 size-9 text-muted-foreground" />
              <span className="text-sm font-medium">Select TCX folder</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {SOURCE_LABELS[source] ?? source}
              </span>
              </button>
            </div>
          </div>

          {isParsing || previewMutation.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Upload className="size-4" />
              <span>{isParsing ? "Parsing TCX files..." : "Checking duplicates..."}</span>
            </div>
          ) : null}

          {parseError ? <ErrorMessage message={parseError} /> : null}
          {previewMutation.error instanceof Error ? (
            <ErrorMessage message={previewMutation.error.message} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StepIndicator({ active }: { active: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "select", label: "Select" },
    { id: "review", label: "Review" },
    { id: "complete", label: "Complete" },
  ];
  const activeIndex = steps.findIndex((step) => step.id === active);

  return (
    <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((step, index) => (
        <span key={step.id} className="flex items-center gap-2">
          {index > 0 ? <span className="text-border">›</span> : null}
          <span
            className={
              step.id === active
                ? "font-medium text-foreground"
                : index < activeIndex
                  ? "text-green-600"
                  : ""
            }
          >
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4" />
      <span>{message}</span>
    </div>
  );
}

interface ReviewStepProps {
  preview: PreviewResult;
  selectedCount: number;
  selectedFingerprints: Set<string>;
  parseWarnings: ParseWarning[];
  isCommitting: boolean;
  commitError: string | null;
  onBack: () => void;
  onToggleRun: (run: PreviewRun) => void;
  onSelectAllNew: () => void;
  onClearSelection: () => void;
  onCommit: () => void;
}

function ReviewStep({
  preview,
  selectedCount,
  selectedFingerprints,
  parseWarnings,
  isCommitting,
  commitError,
  onBack,
  onToggleRun,
  onSelectAllNew,
  onClearSelection,
  onCommit,
}: ReviewStepProps) {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Select
        </button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Review TCX Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {preview.newCount} new, {preview.duplicateCount} duplicate,{" "}
          {preview.skippedInvalidCount} invalid.
        </p>
      </div>

      <StepIndicator active="review" />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <SummaryTile label="Parsed" value={preview.runs.length} />
        <SummaryTile label="New" value={preview.newCount} />
        <SummaryTile label="Duplicates" value={preview.duplicateCount} />
        <SummaryTile label="Selected" value={selectedCount} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onSelectAllNew}>
          <CheckSquare className="size-3.5" />
          Select New
        </Button>
        <Button size="sm" variant="outline" onClick={onClearSelection}>
          <Square className="size-3.5" />
          Clear
        </Button>
        <span className="text-xs text-muted-foreground">
          Source: {SOURCE_LABELS[preview.source] ?? preview.source}
        </span>
      </div>

      {parseWarnings.length > 0 ? (
        <Card className="mb-4 border-yellow-500/40">
          <CardContent className="py-3">
            <div className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-300">
              <AlertCircle className="mt-0.5 size-4" />
              <div>
                <p>{parseWarnings.length} file skipped during parsing.</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {parseWarnings.slice(0, 5).map((warning) => (
                    <li key={warning.fileName}>
                      <span className="font-mono">{warning.fileName}</span>:{" "}
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 space-y-2">
        {preview.runs.map((run) => (
          <RunRow
            key={`${run.fingerprint}:${run.fileName}`}
            run={run}
            selected={!run.isDuplicate && selectedFingerprints.has(run.fingerprint)}
            onToggle={() => onToggleRun(run)}
          />
        ))}
      </div>

      {commitError ? <ErrorMessage message={commitError} /> : null}

      <div className="mt-4 flex justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={isCommitting}>
          Back
        </Button>
        <Button
          onClick={onCommit}
          disabled={isCommitting || selectedCount === 0}
        >
          {isCommitting ? "Importing..." : `Import ${selectedCount} Runs`}
        </Button>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onToggle,
}: {
  run: PreviewRun;
  selected: boolean;
  onToggle: () => void;
}) {
  const startedAt = new Date(run.startedAt);

  return (
    <div
      className={[
        "flex items-start gap-3 border p-3 transition-colors",
        run.isDuplicate
          ? "opacity-60"
          : selected
            ? "cursor-pointer border-primary bg-primary/5"
            : "cursor-pointer hover:bg-muted/30",
      ].join(" ")}
      onClick={run.isDuplicate ? undefined : onToggle}
    >
      <Checkbox
        checked={selected}
        disabled={run.isDuplicate}
        onCheckedChange={onToggle}
        onClick={(event) => event.stopPropagation()}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{run.fileName}</span>
          <Badge variant={run.isDuplicate ? "secondary" : "outline"}>
            {run.isDuplicate ? "Duplicate" : "New"}
          </Badge>
          <Badge variant="outline">{run.exerciseName}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{format(startedAt, "MMM d, yyyy 'at' h:mm a")}</span>
          <span>{formatDistanceMeters(run.distanceMeter)}</span>
          <span>{formatDuration(run.durationSeconds)}</span>
          {run.avgHeartRate != null ? <span>{run.avgHeartRate} bpm avg</span> : null}
          {run.calories != null ? <span>{run.calories} cal</span> : null}
        </div>
      </div>
    </div>
  );
}

function CompleteStep({
  result,
  onStartOver,
}: {
  result: CommitResult;
  onStartOver: () => void;
}) {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      <StepIndicator active="complete" />

      <Card>
        <CardContent className="space-y-5 py-8 text-center">
          <CheckCircle className="mx-auto size-10 text-green-600" />
          <div>
            <h1 className="text-xl font-semibold">Import Complete</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              TCX runs have been imported.
            </p>
          </div>

          <div className="mx-auto grid max-w-sm grid-cols-3 gap-3">
            <SummaryTile label="Created" value={result.createdCount} />
            <SummaryTile
              label="Duplicates"
              value={result.skippedDuplicateCount}
            />
            <SummaryTile label="Invalid" value={result.skippedInvalidCount} />
          </div>

          <div className="flex justify-center gap-3 pt-2">
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
