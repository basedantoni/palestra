import type { ReactFormExtendedApi } from "@tanstack/react-form";

import { Label } from "@/components/ui/label";

const WEIGHT_UNITS = [
  { value: "lbs", label: "Pounds (lbs)" },
  { value: "kg", label: "Kilograms (kg)" },
] as const;

const DISTANCE_UNITS = [
  { value: "mi", label: "Miles (mi)" },
  { value: "km", label: "Kilometers (km)" },
] as const;

const MUSCLE_GROUP_SYSTEMS = [
  { value: "bodybuilding", label: "Bodybuilding", description: "Chest, Back, Shoulders, Arms, Legs, Core" },
  { value: "movement_patterns", label: "Movement Patterns", description: "Push, Pull, Squat, Hinge, Carry" },
] as const;

const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto (System)" },
] as const;

interface StepPreferencesProps {
  form: ReactFormExtendedApi<any, any, any, any>;
}

export default function StepPreferences({ form }: StepPreferencesProps) {
  return (
    <div className="space-y-6">
      <div>
        <Label className="text-base font-semibold">Weight Unit</Label>
        <form.Field name="weightUnit">
          {(field) => (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {WEIGHT_UNITS.map((unit) => (
                <button
                  key={unit.value}
                  type="button"
                  onClick={() => field.handleChange(unit.value)}
                  className={`flex cursor-pointer items-center gap-2 border p-3 text-left transition-colors hover:bg-muted ${
                    field.state.value === unit.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{unit.label}</span>
                </button>
              ))}
            </div>
          )}
        </form.Field>
      </div>

      <div>
        <Label className="text-base font-semibold">Distance Unit</Label>
        <form.Field name="distanceUnit">
          {(field) => (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {DISTANCE_UNITS.map((unit) => (
                <button
                  key={unit.value}
                  type="button"
                  onClick={() => field.handleChange(unit.value)}
                  className={`flex cursor-pointer items-center gap-2 border p-3 text-left transition-colors hover:bg-muted ${
                    field.state.value === unit.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{unit.label}</span>
                </button>
              ))}
            </div>
          )}
        </form.Field>
      </div>

      <div>
        <Label className="text-base font-semibold">Muscle Group Categorization</Label>
        <form.Field name="muscleGroupSystem">
          {(field) => (
            <div className="mt-2 grid grid-cols-1 gap-3">
              {MUSCLE_GROUP_SYSTEMS.map((sys) => (
                <button
                  key={sys.value}
                  type="button"
                  onClick={() => field.handleChange(sys.value)}
                  className={`flex cursor-pointer flex-col border p-3 text-left transition-colors hover:bg-muted ${
                    field.state.value === sys.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm font-medium">{sys.label}</span>
                  <span className="text-xs text-muted-foreground">{sys.description}</span>
                </button>
              ))}
            </div>
          )}
        </form.Field>
      </div>

      <div>
        <Label className="text-base font-semibold">Theme</Label>
        <form.Field name="theme">
          {(field) => (
            <div className="mt-2 grid grid-cols-3 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => field.handleChange(t.value)}
                  className={`flex cursor-pointer items-center justify-center border p-3 transition-colors hover:bg-muted ${
                    field.state.value === t.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <span className="text-sm">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </form.Field>
      </div>
    </div>
  );
}
