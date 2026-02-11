import type { ReactFormExtendedApi } from "@tanstack/react-form";
import z from "zod";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

interface StepMetricsProps {
  form: ReactFormExtendedApi<any, any, any, any>;
}

export default function StepMetrics({ form }: StepMetricsProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        This information helps personalize your experience. All fields are optional.
      </p>

      <div>
        <Label className="text-base font-semibold">Gender</Label>
        <form.Field name="gender">
          {(field) => (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {GENDERS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => field.handleChange(g.value)}
                    className={`flex cursor-pointer items-center gap-2 border p-3 text-left transition-colors hover:bg-muted ${
                      field.state.value === g.value
                        ? "border-primary bg-primary/5"
                        : ""
                    }`}
                  >
                    <span className="text-sm">{g.label}</span>
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

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="birthYear">Birth Year</Label>
          <form.Field
            name="birthYear"
            validators={{
              onChange: z
                .number()
                .int()
                .min(1920, "Please enter a valid year")
                .max(2020, "Please enter a valid year")
                .optional(),
            }}
          >
            {(field) => (
              <>
                <Input
                  id="birthYear"
                  name={field.name}
                  type="number"
                  placeholder="1990"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.handleChange(val === "" ? undefined : Number(val));
                  }}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </>
            )}
          </form.Field>
        </div>

        <div className="space-y-2">
          <Label htmlFor="heightCm">Height (cm)</Label>
          <form.Field
            name="heightCm"
            validators={{
              onChange: z
                .number()
                .int()
                .min(50, "Please enter a valid height")
                .max(300, "Please enter a valid height")
                .optional(),
            }}
          >
            {(field) => (
              <>
                <Input
                  id="heightCm"
                  name={field.name}
                  type="number"
                  placeholder="175"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.handleChange(val === "" ? undefined : Number(val));
                  }}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </>
            )}
          </form.Field>
        </div>

        <div className="space-y-2">
          <Label htmlFor="weightKg">Weight (kg)</Label>
          <form.Field
            name="weightKg"
            validators={{
              onChange: z
                .number()
                .int()
                .min(20, "Please enter a valid weight")
                .max(500, "Please enter a valid weight")
                .optional(),
            }}
          >
            {(field) => (
              <>
                <Input
                  id="weightKg"
                  name={field.name}
                  type="number"
                  placeholder="75"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.handleChange(val === "" ? undefined : Number(val));
                  }}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </>
            )}
          </form.Field>
        </div>
      </div>
    </div>
  );
}
