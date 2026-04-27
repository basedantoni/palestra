import { describe, expect, it } from "vitest";

import {
  deterministicUUID,
  MOBILITY_SEED_EXERCISES,
  RUNNING_SEED_EXERCISES,
  SEED_EXERCISES,
  SEED_WORKOUT_TEMPLATE_EXERCISES,
  SEED_WORKOUT_TEMPLATES,
  SYSTEM_TEMPLATES,
} from "@src/db/seed";

describe("running and mobility seed data", () => {
  it("seeds running exercises as cardio-category entries with cardio/hiit typing", () => {
    expect(RUNNING_SEED_EXERCISES).toHaveLength(17);
    expect(
      RUNNING_SEED_EXERCISES.every((exercise) => exercise.category === "cardio"),
    ).toBe(true);
    expect(
      RUNNING_SEED_EXERCISES.every(
        (exercise) =>
          exercise.isCustom === false && exercise.createdByUserId === null,
      ),
    ).toBe(true);

    const cardioExerciseNames = RUNNING_SEED_EXERCISES.filter(
      (exercise) => exercise.exerciseType === "cardio",
    ).map((exercise) => exercise.name);
    const hiitExerciseNames = RUNNING_SEED_EXERCISES.filter(
      (exercise) => exercise.exerciseType === "hiit",
    ).map((exercise) => exercise.name);

    expect(cardioExerciseNames).toEqual([
      "Short Run",
      "Long Run",
      "Tempo Run",
      "Recovery Run",
      "Warm Up Run",
      "Cool Down Run",
      "Fartlek Run",
      "Progression Run",
      "Treadmill Run",
      "Trail Run",
    ]);
    expect(hiitExerciseNames).toEqual([
      "Sprint",
      "Interval Run",
      "Hill Sprint",
      "Strides",
      "400m Repeat",
      "800m Repeat",
      "Mile Repeat",
    ]);
  });

  it("seeds the planned mobility exercises as mobility entries", () => {
    expect(MOBILITY_SEED_EXERCISES).toHaveLength(39);
    expect(
      MOBILITY_SEED_EXERCISES.every(
        (exercise) =>
          exercise.category === "other" &&
          exercise.exerciseType === "mobility" &&
          exercise.isCustom === false &&
          exercise.createdByUserId === null,
      ),
    ).toBe(true);
  });

  it("defines the planned system templates with null default sets", () => {
    expect(SEED_WORKOUT_TEMPLATES).toHaveLength(5);
    expect(SYSTEM_TEMPLATES.map((template) => template.name)).toEqual([
      "Sprint Session",
      "Short Run",
      "Long Run",
      "Interval Session",
      "Full-Body Mobility",
    ]);

    const templateExercisesById = new Map<string, typeof SEED_WORKOUT_TEMPLATE_EXERCISES>(
      SEED_WORKOUT_TEMPLATES.map((template) => [
        template.id,
        SEED_WORKOUT_TEMPLATE_EXERCISES
          .filter((exercise) => exercise.workoutTemplateId === template.id)
          .sort((left, right) => left.order - right.order),
      ]),
    );

    for (const template of SYSTEM_TEMPLATES) {
      const templateId = deterministicUUID(`template:${template.name}`);
      const seededExercises = templateExercisesById.get(templateId);

      expect(seededExercises).toBeDefined();
      expect(seededExercises?.map((exercise) => exercise.exerciseId)).toEqual(
        template.exercises.map((exerciseName) => deterministicUUID(exerciseName)),
      );
      expect(
        seededExercises?.every((exercise) => exercise.defaultSets === null),
      ).toBe(true);
    }

    const mobilityTemplate = SEED_WORKOUT_TEMPLATES.find(
      (template) => template.name === "Full-Body Mobility",
    );
    expect(mobilityTemplate?.workoutType).toBe("yoga");
  });

  it("keeps exercise and template identifiers deterministic and unique", () => {
    const exerciseIds = SEED_EXERCISES.map((exercise) => deterministicUUID(exercise.name));
    const templateIds = SEED_WORKOUT_TEMPLATES.map((template) => template.id);
    const templateExerciseIds = SEED_WORKOUT_TEMPLATE_EXERCISES.map(
      (exercise) => exercise.id,
    );

    expect(new Set(SEED_EXERCISES.map((exercise) => exercise.name)).size).toBe(
      SEED_EXERCISES.length,
    );
    expect(new Set(exerciseIds).size).toBe(exerciseIds.length);
    expect(new Set(templateIds).size).toBe(templateIds.length);
    expect(new Set(templateExerciseIds).size).toBe(templateExerciseIds.length);
  });
});
