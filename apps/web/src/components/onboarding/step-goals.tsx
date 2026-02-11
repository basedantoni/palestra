import type { ReactFormExtendedApi } from "@tanstack/react-form";
import z from "zod";

import { Label } from "@/components/ui/label";

const GOALS = [
  { value: "build_muscle", label: "Build Muscle", description: "Gain size and definition" },
  { value: "lose_fat", label: "Lose Fat", description: "Cut body fat while maintaining muscle" },
  { value: "increase_strength", label: "Increase Strength", description: "Lift heavier weights" },
  { value: "improve_endurance", label: "Improve Endurance", description: "Better cardiovascular fitness" },
  { value: "general_fitness", label: "General Fitness", description: "Overall health and wellness" },
  { value: "flexibility", label: "Flexibility", description: "Improve mobility and range of motion" },
] as const;

const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner", description: "New to fitness or less than 6 months" },
  { value: "intermediate", label: "Intermediate", description: "6 months to 2 years of training" },
  { value: "advanced", label: "Advanced", description: "2+ years of consistent training" },
] as const;

interface StepGoalsProps {
  form: ReactFormExtendedApi<any, any, any, any>;
}

export default function StepGoals({ form }: StepGoalsProps) {
  return (
    <div className="space-y-6">
      <div>
        <Label className="text-base font-semibold">What's your primary fitness goal?</Label>
        <form.Field
          name="fitnessGoal"
          validators={{
            onChange: z.enum([
              "build_muscle", "lose_fat", "increase_strength",
              "improve_endurance", "general_fitness", "flexibility",
            ]),
          }}
        >
          {(field) => (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {GOALS.map((goal) => (
                  <button
                    key={goal.value}
                    type="button"
                    onClick={() => field.handleChange(goal.value)}
                    className={`flex cursor-pointer flex-col border p-3 text-left transition-colors hover:bg-muted ${
                      field.state.value === goal.value
                        ? "border-primary bg-primary/5"
                        : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{goal.label}</span>
                    <span className="text-xs text-muted-foreground">{goal.description}</span>
                  </button>
                ))}
              </div>
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="mt-1 text-xs text-destructive">
                  {error?.message}
                </p>
              ))}
            </>
          )}
        </form.Field>
      </div>

      <div>
        <Label className="text-base font-semibold">What's your experience level?</Label>
        <form.Field
          name="experienceLevel"
          validators={{
            onChange: z.enum(["beginner", "intermediate", "advanced"]),
          }}
        >
          {(field) => (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {EXPERIENCE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => field.handleChange(level.value)}
                    className={`flex cursor-pointer flex-col border p-3 text-left transition-colors hover:bg-muted ${
                      field.state.value === level.value
                        ? "border-primary bg-primary/5"
                        : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{level.label}</span>
                    <span className="text-xs text-muted-foreground">{level.description}</span>
                  </button>
                ))}
              </div>
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="mt-1 text-xs text-destructive">
                  {error?.message}
                </p>
              ))}
            </>
          )}
        </form.Field>
      </div>
    </div>
  );
}
