import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { UploadStep } from "@/components/import/upload-step";
import { ResolveStep } from "@/components/import/resolve-step";
import { PreviewStep } from "@/components/import/preview-step";
import { CompleteStep } from "@/components/import/complete-step";
import type { ParseResult } from "@/components/import/upload-step";
import type { Resolution } from "@/components/import/resolve-step";

export const Route = createFileRoute("/import")({
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
