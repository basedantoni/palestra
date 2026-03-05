import { useForm } from "@tanstack/react-form";

import {
  onboardingSchema,
  type OnboardingFormData,
} from "@src/shared";

const DEFAULT_VALUES: OnboardingFormData = {
  fitnessGoal: "general_fitness",
  experienceLevel: "beginner",
  preferredWorkoutTypes: [],
  gender: undefined,
  birthYear: undefined,
  heightCm: undefined,
  weightKg: undefined,
  weightUnit: "lbs",
  distanceUnit: "mi",
  muscleGroupSystem: "bodybuilding",
  theme: "dark",
};

export function useOnboardingForm(
  onSubmit: (value: OnboardingFormData) => void | Promise<void>,
) {
  return useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
    validators: {
      onSubmit: onboardingSchema,
    },
  });
}

export type OnboardingFormApi = ReturnType<typeof useOnboardingForm>;
