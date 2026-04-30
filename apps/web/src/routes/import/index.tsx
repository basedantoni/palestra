import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Upload, Zap } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadStep } from "@/components/import/upload-step";
import { ResolveStep } from "@/components/import/resolve-step";
import { PreviewStep } from "@/components/import/preview-step";
import { CompleteStep } from "@/components/import/complete-step";
import type { ParseResult } from "@/components/import/upload-step";
import type { Resolution } from "@/components/import/resolve-step";

export const Route = createFileRoute("/import/")({
  component: ImportPage,
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

type WizardStep = "upload" | "resolve" | "preview" | "complete";

function ImportPage() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [resolutionMap, setResolutionMap] = useState<Record<string, Resolution>>(
    {},
  );
  const [duplicateDates, setDuplicateDates] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{
    importedCount: number;
    skippedCount: number;
    createdExerciseCount: number;
  } | null>(null);

  // Fetch duplicate dates when we enter the resolve step
  const nonRestDates =
    parseResult?.workouts.filter((w) => !w.isRestDay).map((w) => w.date) ?? [];

  const duplicateQuery = useQuery({
    ...trpc.import.checkDuplicateDates.queryOptions({ dates: nonRestDates }),
    enabled: nonRestDates.length > 0 && step === "resolve",
  });

  // Sync duplicate dates from query result
  useEffect(() => {
    if (duplicateQuery.data) {
      setDuplicateDates(duplicateQuery.data);
    }
  }, [duplicateQuery.data]);

  const handleUploadComplete = (result: ParseResult) => {
    setParseResult(result);
    setDuplicateDates([]);
    setStep("resolve");
  };

  const handleResolveComplete = (map: Record<string, Resolution>) => {
    setResolutionMap(map);
    setStep("preview");
  };

  const handleImportComplete = (
    importedCount: number,
    skippedCount: number,
    createdExerciseCount: number,
  ) => {
    setImportResult({ importedCount, skippedCount, createdExerciseCount });
    setStep("complete");
  };

  const handleReset = () => {
    setStep("upload");
    setParseResult(null);
    setResolutionMap({});
    setDuplicateDates([]);
    setImportResult(null);
  };

  const stepLabels: Record<WizardStep, string> = {
    upload: "Upload",
    resolve: "Resolve Exercises",
    preview: "Preview",
    complete: "Complete",
  };

  const stepOrder: WizardStep[] = ["upload", "resolve", "preview", "complete"];
  const currentStepIndex = stepOrder.indexOf(step);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      {/* Import source picker — shown only on the initial upload step */}
      {step === "upload" && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Import Workouts</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Choose an import source below.
          </p>
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            {/* Whoop import card */}
            <Card className="border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Whoop</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Import workout activities directly from your connected Whoop account.
                </p>
                <Link to="/import/whoop">
                  <Button size="sm" className="w-full">
                    Import from Whoop
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* TCX folder import card */}
            <Card className="border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">TCX Folder</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Import running workouts from a folder of TCX files.
                </p>
                <Link to="/import/tcx">
                  <Button size="sm" className="w-full">
                    Import TCX Files
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Markdown / manual import card */}
            <Card className="border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Markdown Log</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Upload a structured markdown workout log file.
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Upload a Markdown File</p>
          </div>
        </div>
      )}

      {/* Step indicator */}
      {step !== "complete" && (
        <div className="flex items-center gap-2 mb-6 text-xs text-muted-foreground">
          {stepOrder.slice(0, 3).map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-border">›</span>}
              <span
                className={
                  s === step
                    ? "text-foreground font-medium"
                    : i < currentStepIndex
                      ? "text-green-600"
                      : ""
                }
              >
                {stepLabels[s]}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Step content */}
      {step === "upload" && <UploadStep onComplete={handleUploadComplete} />}

      {step === "resolve" && parseResult && (
        <ResolveStep
          exerciseNames={parseResult.uniqueExerciseNames}
          duplicateDates={duplicateDates}
          onComplete={handleResolveComplete}
          onBack={() => setStep("upload")}
        />
      )}

      {step === "preview" && parseResult && (
        <PreviewStep
          workouts={parseResult.workouts}
          resolutionMap={resolutionMap}
          duplicateDates={duplicateDates}
          onComplete={handleImportComplete}
          onBack={() => setStep("resolve")}
        />
      )}

      {step === "complete" && importResult && (
        <CompleteStep
          importedCount={importResult.importedCount}
          skippedCount={importResult.skippedCount}
          createdExerciseCount={importResult.createdExerciseCount}
          onImportAnother={handleReset}
        />
      )}
    </div>
  );
}
