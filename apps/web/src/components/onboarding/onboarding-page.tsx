import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import {
  STEP_FIELD_NAMES,
  TOTAL_STEPS,
  type OnboardingFormData,
} from "@src/shared";

import StepGoals from "./step-goals";
import StepWorkouts from "./step-workouts";
import StepMetrics from "./step-metrics";
import StepPreferences from "./step-preferences";
import OnboardingProgress from "./onboarding-progress";
import { useOnboardingForm } from "./use-onboarding-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();
  const saveMutation = useMutation(
    trpc.preferences.upsert.mutationOptions({
      onSuccess: () => {
        toast.success("Profile setup complete!");
        navigate({ to: "/dashboard" });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save preferences");
      },
    })
  );

  const form = useOnboardingForm(async (value) => {
      saveMutation.mutate({
        ...value,
        plateauThreshold: 3,
        onboardingCompleted: true,
      });
  });

  const handleNext = useCallback(async () => {
    const fieldNames = STEP_FIELD_NAMES[currentStep];

    // Validate all fields in the current step
    const validationResults = await Promise.all(
      fieldNames.map((fieldName) => form.validateField(fieldName, "change"))
    );

    // Check if any field in this step has errors
    const hasErrors = fieldNames.some((fieldName) => {
      const fieldMeta = form.getFieldMeta(fieldName);
      return fieldMeta && fieldMeta.errors.length > 0;
    });

    if (!hasErrors) {
      setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS - 1));
    }
  }, [currentStep, form]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">Set Up Your Profile</h1>
        <p className="mt-2 text-muted-foreground">
          Let's personalize your fitness experience
        </p>
      </div>

      <OnboardingProgress currentStep={currentStep} totalSteps={TOTAL_STEPS} />

      <Card className="mt-6 p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          {currentStep === 0 ? <StepGoals form={form} /> : null}
          {currentStep === 1 ? <StepWorkouts form={form} /> : null}
          {currentStep === 2 ? <StepPreferences form={form} /> : null}
          {currentStep === 3 ? <StepMetrics form={form} /> : null}

          <div className="mt-8 flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 0}
            >
              Back
            </Button>

            {isLastStep ? (
              <form.Subscribe>
                {(state) => (
                  <Button
                    type="submit"
                    disabled={!state.canSubmit || state.isSubmitting || saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "Saving..." : "Complete Setup"}
                  </Button>
                )}
              </form.Subscribe>
            ) : (
              <Button type="button" onClick={handleNext}>
                Next
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
