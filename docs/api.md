# API Documentation

This document describes the tRPC API surface for authenticated user flows and admin management.

## Authentication

- All procedures are tRPC.
- `publicProcedure` is unauthenticated.
- `protectedProcedure` requires a session (set by Better Auth).
- `adminProcedure` requires a session and the user email to be listed in `ADMIN_EMAILS`.

Environment:

- `ADMIN_EMAILS`: comma-separated list of admin user emails.

## Routers

### Health

**Procedure**: `healthCheck`

- Type: `publicProcedure`
- Description: Returns a simple OK payload.

**Procedure**: `privateData`

- Type: `protectedProcedure`
- Description: Returns the current user session payload.

### Preferences (Authenticated)

**Router**: `preferences`

**Procedure**: `get`

- Type: `protectedProcedure`
- Description: Returns the current user preferences or null.

**Procedure**: `upsert`

- Type: `protectedProcedure`
- Input:

```ts
{
  weightUnit: "lbs" | "kg"
  distanceUnit: "mi" | "km"
  muscleGroupSystem: "bodybuilding" | "movement_patterns"
  plateauThreshold: number
  theme: "light" | "dark" | "auto"
}
```

- Description: Creates or updates the current user's preferences.

### Exercises (Authenticated)

**Router**: `exercises`

**Procedure**: `list`

- Type: `protectedProcedure`
- Input (optional):

```ts
{
  includeCustom?: boolean
}
```

- Description: Returns system exercises plus the user's custom exercises.

**Procedure**: `createCustom`

- Type: `protectedProcedure`
- Input:

```ts
{
  name: string
  category: "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio" | "other"
  exerciseType: "weightlifting" | "hiit" | "cardio" | "calisthenics" | "yoga" | "sports" | "mixed"
  muscleGroupsBodybuilding?: ("chest" | "back" | "shoulders" | "arms" | "legs" | "core")[]
  muscleGroupsMovement?: ("push" | "pull" | "squat" | "hinge" | "carry")[]
}
```

- Description: Creates a custom exercise for the current user.

**Procedure**: `updateCustom`

- Type: `protectedProcedure`
- Input: `createCustom` plus `id: string`.
- Description: Updates a custom exercise owned by the current user.

**Procedure**: `deleteCustom`

- Type: `protectedProcedure`
- Input: `{ id: string }`
- Description: Deletes a custom exercise owned by the current user.

### Workouts (Authenticated)

**Router**: `workouts`

**Procedure**: `list`

- Type: `protectedProcedure`
- Input (optional):

```ts
{
  limit?: number
  offset?: number
}
```

- Description: Lists the user's workouts, newest first.

**Procedure**: `get`

- Type: `protectedProcedure`
- Input: `{ id: string }`
- Description: Fetches a workout by id including logs and sets.

**Procedure**: `create`

- Type: `protectedProcedure`
- Input:

```ts
{
  date: Date
  workoutType: "weightlifting" | "hiit" | "cardio" | "calisthenics" | "yoga" | "sports" | "mixed"
  durationMinutes?: number
  templateId?: string
  notes?: string
  totalVolume?: number
  logs: {
    exerciseId?: string
    exerciseName: string
    order: number
    rounds?: number
    workDurationSeconds?: number
    restDurationSeconds?: number
    intensity?: number
    distance?: number
    durationSeconds?: number
    pace?: number
    heartRate?: number
    durationMinutes?: number
    notes?: string
    sets?: {
      setNumber: number
      reps?: number
      weight?: number
      rpe?: number
    }[]
  }[]
}
```

- Description: Creates a workout and its logs/sets in a transaction.

**Procedure**: `update`

- Type: `protectedProcedure`
- Input: `create` input plus `id: string`.
- Description: Updates a workout and replaces its logs/sets.

**Procedure**: `delete`

- Type: `protectedProcedure`
- Input: `{ id: string }`
- Description: Deletes a workout by id.

### Templates (Authenticated)

**Router**: `templates`

**Procedure**: `list`

- Type: `protectedProcedure`
- Input (optional): `{ includeSystem?: boolean }`
- Description: Lists user templates plus system templates.

**Procedure**: `get`

- Type: `protectedProcedure`
- Input: `{ id: string }`
- Description: Fetches a template and its exercises (user or system).

**Procedure**: `create`

- Type: `protectedProcedure`
- Input:

```ts
{
  name: string
  workoutType: "weightlifting" | "hiit" | "cardio" | "calisthenics" | "yoga" | "sports" | "mixed"
  notes?: string
  exercises: {
    exerciseId?: string
    order: number
    defaultSets?: number
  }[]
}
```

- Description: Creates a user template with ordered exercises.

**Procedure**: `update`

- Type: `protectedProcedure`
- Input: `create` input plus `id: string`.
- Description: Updates a user template and replaces exercises.

**Procedure**: `delete`

- Type: `protectedProcedure`
- Input: `{ id: string }`
- Description: Deletes a user template.

### Analytics (Authenticated)

**Router**: `analytics`

**Procedure**: `personalRecords`

- Type: `protectedProcedure`
- Input (optional): `{ exerciseId?: string }`
- Description: Returns personal records for the user, optionally scoped to an exercise.

**Procedure**: `progressiveOverload`

- Type: `protectedProcedure`
- Input (optional): `{ exerciseId?: string }`
- Description: Returns progressive overload state rows for the user.

**Procedure**: `muscleGroupVolume`

- Type: `protectedProcedure`
- Input (optional):

```ts
{
  startDate?: Date
  endDate?: Date
  categorizationSystem?: "bodybuilding" | "movement_patterns"
}
```

- Description: Returns weekly muscle group volume aggregations.

### Admin (Admin Only)

**Router**: `admin`

**Procedure**: `exercisesList`

- Type: `adminProcedure`
- Description: Lists all exercises (including system ones).

**Procedure**: `exercisesCreate`

- Type: `adminProcedure`
- Input: Same as `exercises.createCustom`.
- Description: Creates a system exercise (non-custom).

**Procedure**: `exercisesUpdate`

- Type: `adminProcedure`
- Input: Same as `exercises.updateCustom`.
- Description: Updates a system exercise.

**Procedure**: `exercisesDelete`

- Type: `adminProcedure`
- Input: `{ id: string }`
- Description: Deletes a system exercise.

**Procedure**: `templatesList`

- Type: `adminProcedure`
- Description: Lists system templates.

**Procedure**: `templatesCreate`

- Type: `adminProcedure`
- Input: Same as `templates.create`.
- Description: Creates a system template.

**Procedure**: `templatesUpdate`

- Type: `adminProcedure`
- Input: Same as `templates.update`.
- Description: Updates a system template.

**Procedure**: `templatesDelete`

- Type: `adminProcedure`
- Input: `{ id: string }`
- Description: Deletes a system template.
