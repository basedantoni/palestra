import { useState } from "react";
import z from "zod";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GENDERS } from "@src/shared";
import type { OnboardingFormApi } from "./use-onboarding-form";

interface StepMetricsProps {
  form: OnboardingFormApi;
}

export default function StepMetrics({ form }: StepMetricsProps) {
  // Get user's preferred units from form state
  const weightUnit = form.getFieldValue("weightUnit") ?? "lbs";
  const distanceUnit = form.getFieldValue("distanceUnit") ?? "mi";

  // Conversion functions (keep decimals for smooth input)
  const cmToInches = (cm: number) => Math.round(cm * 0.393701 * 10) / 10;
  const inchesToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;
  const kgToLbs = (kg: number) => Math.round(kg * 2.20462 * 10) / 10;
  const lbsToKg = (lbs: number) => Math.round(lbs / 2.20462 * 10) / 10;

  // Unit labels and placeholders
  const heightUnit = distanceUnit === "mi" ? "in" : "cm";
  const heightPlaceholder = distanceUnit === "mi" ? "70" : "175";
  const weightPlaceholder = weightUnit === "lbs" ? "165" : "75";

  // Local state for user input (at top level, not in callbacks)
  const heightCmValue = form.getFieldValue("heightCm");
  const weightKgValue = form.getFieldValue("weightKg");

  const initialHeight = heightCmValue
    ? (distanceUnit === "mi" ? cmToInches(heightCmValue) : heightCmValue).toString()
    : "";
  const initialWeight = weightKgValue
    ? (weightUnit === "lbs" ? kgToLbs(weightKgValue) : weightKgValue).toString()
    : "";

  const [heightInput, setHeightInput] = useState(initialHeight);
  const [weightInput, setWeightInput] = useState(initialWeight);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        This information helps personalize your experience. All fields are
        optional.
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
              {field.state.meta.errors.map((error, index) => (
                <p
                  key={`gender-error-${index}`}
                  className="mt-1 text-xs text-destructive"
                >
                  {String(error)}
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
          <Label htmlFor="heightCm">Height ({heightUnit})</Label>
          <form.Field
            name="heightCm"
            validators={{
              onChange: z
                .number()
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
                  placeholder={heightPlaceholder}
                  value={heightInput}
                  onChange={(e) => {
                    // Just update local state while typing
                    setHeightInput(e.target.value);
                  }}
                  onBlur={(e) => {
                    field.handleBlur();
                    const val = e.target.value;
                    if (val === "") {
                      field.handleChange(undefined);
                    } else {
                      const inputVal = Number(val);
                      // Convert to cm for storage
                      const cmVal =
                        distanceUnit === "mi"
                          ? inchesToCm(inputVal)
                          : inputVal;
                      field.handleChange(cmVal);
                    }
                  }}
                />
                {field.state.meta.errors.map((error) => (
                  <p
                    key={error?.message}
                    className="text-xs text-destructive"
                  >
                    {error?.message}
                  </p>
                ))}
              </>
            )}
          </form.Field>
        </div>

        <div className="space-y-2">
          <Label htmlFor="weightKg">Weight ({weightUnit})</Label>
          <form.Field
            name="weightKg"
            validators={{
              onChange: z
                .number()
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
                  placeholder={weightPlaceholder}
                  value={weightInput}
                  onChange={(e) => {
                    // Just update local state while typing
                    setWeightInput(e.target.value);
                  }}
                  onBlur={(e) => {
                    field.handleBlur();
                    const val = e.target.value;
                    if (val === "") {
                      field.handleChange(undefined);
                    } else {
                      const inputVal = Number(val);
                      // Convert to kg for storage
                      const kgVal =
                        weightUnit === "lbs" ? lbsToKg(inputVal) : inputVal;
                      field.handleChange(kgVal);
                    }
                  }}
                />
                {field.state.meta.errors.map((error) => (
                  <p
                    key={error?.message}
                    className="text-xs text-destructive"
                  >
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
