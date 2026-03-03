import type { ReactFormExtendedApi } from "@tanstack/react-form";
import z from "zod";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { WORKOUT_TYPES } from "@src/shared";

interface StepWorkoutsProps {
  form: ReactFormExtendedApi<any, any, any, any>;
}

export default function StepWorkouts({ form }: StepWorkoutsProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">
          What types of workouts do you do?
        </Label>
        <p className="text-sm text-muted-foreground">Select all that apply</p>
      </div>

      <form.Field
        name="preferredWorkoutTypes"
        validators={{
          onChange: z
            .array(z.enum(["weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports"]))
            .min(1, "Select at least one workout type"),
        }}
      >
        {(field) => {
          const selected: string[] = field.state.value ?? [];
          return (
            <>
              <div className="grid grid-cols-2 gap-3">
                {WORKOUT_TYPES.map((type) => {
                  const isChecked = selected.includes(type.value);
                  return (
                    <label
                      key={type.value}
                      className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors hover:bg-muted ${
                        isChecked ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          field.handleChange(
                            checked
                              ? [...selected, type.value]
                              : selected.filter((v) => v !== type.value)
                          );
                        }}
                      />
                      <div>
                        <span className="text-sm font-medium">{type.label}</span>
                        <p className="text-xs text-muted-foreground">{type.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-xs text-destructive">
                  {error?.message}
                </p>
              ))}

              {selected.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {selected.length} workout type{selected.length !== 1 ? "s" : ""} selected
                </p>
              ) : null}
            </>
          );
        }}
      </form.Field>
    </div>
  );
}
