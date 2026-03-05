import { describe, expect, it } from "vitest";

import {
  apiTemplateToFormData,
  templateFormToApiInput,
  type TemplateFormData,
} from "./template-utils";

describe("template-utils", () => {
  describe("apiTemplateToFormData", () => {
    it("should sort exercises by order and map names", () => {
      const form = apiTemplateToFormData(
        {
          name: "Push Day",
          workoutType: "weightlifting",
          notes: "Upper body focus",
          exercises: [
            { exerciseId: "ex-2", order: 1, defaultSets: 4 },
            { exerciseId: "ex-1", order: 0, defaultSets: 3 },
          ],
        },
        {
          "ex-1": "Bench Press",
          "ex-2": "Overhead Press",
        },
      );

      expect(form.name).toBe("Push Day");
      expect(form.notes).toBe("Upper body focus");
      expect(form.exercises[0]?.exerciseName).toBe("Bench Press");
      expect(form.exercises[1]?.exerciseName).toBe("Overhead Press");
      expect(form.exercises[0]?.defaultSets).toBe(3);
    });

    it("should fallback to defaults for missing notes and names", () => {
      const form = apiTemplateToFormData({
        name: "Cardio",
        workoutType: "cardio",
        notes: null,
        exercises: [{ exerciseId: "unknown-id", order: 0, defaultSets: null }],
      });

      expect(form.notes).toBe("");
      expect(form.exercises[0]?.exerciseName).toBe("Unknown Exercise");
      expect(form.exercises[0]?.defaultSets).toBeUndefined();
    });
  });

  describe("templateFormToApiInput", () => {
    it("should normalize notes and recalculate exercise order", () => {
      const form: TemplateFormData = {
        name: "Leg Day",
        workoutType: "weightlifting",
        notes: "",
        exercises: [
          {
            tempId: "a",
            exerciseId: "ex-3",
            exerciseName: "Squat",
            order: 10,
            defaultSets: 5,
          },
          {
            tempId: "b",
            exerciseId: "ex-4",
            exerciseName: "RDL",
            order: 11,
            defaultSets: undefined,
          },
        ],
      };

      const input = templateFormToApiInput(form);

      expect(input.notes).toBeUndefined();
      expect(input.exercises[0]).toMatchObject({ exerciseId: "ex-3", order: 0, defaultSets: 5 });
      expect(input.exercises[1]).toMatchObject({ exerciseId: "ex-4", order: 1, defaultSets: undefined });
    });
  });
});
