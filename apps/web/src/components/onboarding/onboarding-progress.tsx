const STEP_LABELS = ["Goals", "Workouts", "Metrics", "Preferences"];

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export default function OnboardingProgress({
  currentStep,
  totalSteps,
}: OnboardingProgressProps) {
  return (
    <div className="flex items-center justify-between">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={STEP_LABELS[i]} className="flex flex-1 items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center border text-xs font-medium transition-colors ${
                i <= currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </div>
            <span className="mt-1 text-xs text-muted-foreground">
              {STEP_LABELS[i]}
            </span>
          </div>
          {i < totalSteps - 1 ? (
            <div
              className={`mx-2 h-px flex-1 transition-colors ${
                i < currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
