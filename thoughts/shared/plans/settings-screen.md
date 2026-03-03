# Settings Screen Implementation Plan

## Overview

Add a Settings screen to both the web app (TanStack Router) and native app (Expo Router) that lets authenticated users edit their preferences after onboarding and sign out. The existing `preferences.upsert` tRPC mutation and `preferencesInputSchema` already support all needed fields.

## Current State Analysis

**What exists:**
- `packages/api/src/routers/preferences.ts` — `get` (returns all prefs), `upsert` (insert-or-update all fields)
- `packages/shared/src/onboarding-schemas.ts` — `preferencesInputSchema` (requires weightUnit, distanceUnit, muscleGroupSystem, theme, plateauThreshold; other onboarding fields are optional/partial)
- Shared constant arrays: `WEIGHT_UNITS`, `DISTANCE_UNITS`, `MUSCLE_GROUP_SYSTEMS`, `THEMES` with value/label pairs
- `packages/db/src/schema/user-preferences.ts` — `plateauThreshold` column with default 3
- Auth clients: `apps/web/src/lib/auth-client.ts` and `apps/native/lib/auth-client.ts` both export `authClient` with `signOut()` and `useSession()`
- Web user menu (`apps/web/src/components/user-menu.tsx`) already has sign-out in a dropdown
- Native drawer (`apps/native/app/(drawer)/_layout.tsx`) manages navigation; onboarding redirect lives here

**What is missing:**
- No `/settings` route on web
- No settings screen on native
- No way to change preferences post-onboarding
- `plateauThreshold` is never exposed in UI (hard-coded to 3 on web, 2 on native during onboarding)

### Key Discoveries:
- `preferencesInputSchema` requires all `stepPreferencesSchema` fields plus `plateauThreshold` on every call. The settings form must send all five preference fields together, even if only one changed. This is fine -- we load all current values and send the full object. (file: `packages/shared/src/onboarding-schemas.ts:75-82`)
- The onboarding fields (fitnessGoal, experienceLevel, etc.) are optional/partial in `preferencesInputSchema`, so we can omit them from the settings mutation call entirely.
- Web uses `@tanstack/react-form` with `form.Field` pattern (see `apps/web/src/components/onboarding/step-preferences.tsx`)
- Native uses plain `useState` + manual Zod validation (see `apps/native/app/onboarding.tsx`)
- Web route auth guard pattern: `beforeLoad` checks session, redirects to `/login` (see `apps/web/src/routes/dashboard.tsx:14-33`)
- Native auth: `authClient.useSession()` for session state, `authClient.signOut()` for logout (see `apps/native/app/(drawer)/index.tsx:17,43`)

## Desired End State

Both platforms have a Settings screen where authenticated users can:
1. See their name and email (read-only)
2. Change weight unit, distance unit, muscle group system, theme, and plateau threshold
3. Save changes (calls `preferences.upsert`)
4. Sign out

**Verification:**
- Navigate to `/settings` on web -- form loads with current preferences, save works, sign-out works
- Open Settings from drawer on native -- same behavior
- Changing preferences persists across page reloads

## What We're NOT Doing

- Editing onboarding-only fields (fitness goal, experience level, workout types, body metrics) from settings. Those could be a separate "Edit Profile" screen later.
- Implementing a "delete account" flow.
- Adding settings to the native bottom tab bar (it lives in the drawer only).
- Creating a shared cross-platform component library -- web uses Shadcn, native uses heroui-native, so the UI code is platform-specific.

## Implementation Approach

Create a dedicated Zod schema in `packages/shared` for the five editable settings fields. Build a web route at `apps/web/src/routes/settings.tsx` using TanStack Form (matching the onboarding pattern). Build a native screen at `apps/native/app/(drawer)/settings.tsx` using `useState` + Zod (matching the native onboarding pattern). Wire up navigation on both platforms.

---

## Phase 1: Shared Schema

### Overview
Add a `settingsSchema` to `packages/shared` so both platforms validate the same shape.

### Changes Required:

#### 1. Add settings schema to shared package
**File**: `packages/shared/src/onboarding-schemas.ts`
**Changes**: Add a `settingsFormSchema` that extracts only the five editable fields from `preferencesInputSchema`.

Add the following after the existing `preferencesInputSchema` definition (after line 82):

```typescript
// ---------------------------------------------------------------------------
// Settings form schema (subset of preferences used on the Settings screen)
// ---------------------------------------------------------------------------

export const settingsFormSchema = z.object({
  weightUnit: z.enum(["lbs", "kg"]),
  distanceUnit: z.enum(["mi", "km"]),
  muscleGroupSystem: z.enum(["bodybuilding", "movement_patterns"]),
  theme: z.enum(["light", "dark", "auto"]),
  plateauThreshold: z.number().int().min(1).max(20),
});

export type SettingsFormData = z.infer<typeof settingsFormSchema>;
```

#### 2. Export from shared index
**File**: `packages/shared/src/index.ts`
**Changes**: The file already does `export * from "./onboarding-schemas"`, so `settingsFormSchema` and `SettingsFormData` will be automatically exported. No change needed.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `pnpm --filter @src/shared exec tsc --noEmit`
- [ ] Existing shared tests pass: `pnpm --filter @src/shared test`

---

## Phase 2: Web Settings Route

### Overview
Create a `/settings` route with auth guard, load preferences, render an editable form, and handle save + sign-out.

### Changes Required:

#### 1. Create the settings route file
**File**: `apps/web/src/routes/settings.tsx` (new file)
**Changes**: New TanStack Router route with `beforeLoad` auth guard (same pattern as `dashboard.tsx`).

```typescript
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, trpc } from "@/utils/trpc";
import {
  settingsFormSchema,
  WEIGHT_UNITS,
  DISTANCE_UNITS,
  MUSCLE_GROUP_SYSTEMS,
  THEMES,
  type SettingsFormData,
} from "@src/shared";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
    return { session };
  },
});

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const { data: preferences, isLoading } = useQuery(
    trpc.preferences.get.queryOptions()
  );

  const saveMutation = useMutation(
    trpc.preferences.upsert.mutationOptions({
      onSuccess: () => {
        toast.success("Settings saved");
        queryClient.invalidateQueries({ queryKey: trpc.preferences.get.queryOptions().queryKey });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save settings");
      },
    })
  );

  const form = useForm({
    defaultValues: {
      weightUnit: preferences?.weightUnit ?? "lbs",
      distanceUnit: preferences?.distanceUnit ?? "mi",
      muscleGroupSystem: preferences?.muscleGroupSystem ?? "bodybuilding",
      theme: preferences?.theme ?? "auto",
      plateauThreshold: preferences?.plateauThreshold ?? 3,
    } as SettingsFormData,
    validators: {
      onSubmit: settingsFormSchema,
    },
    onSubmit: async ({ value }) => {
      saveMutation.mutate(value);
    },
  });

  // Re-initialize form when preferences load
  // (useForm defaultValues only apply on mount, so we need useEffect for async data)
  React.useEffect(() => {
    if (preferences) {
      form.reset({
        weightUnit: preferences.weightUnit,
        distanceUnit: preferences.distanceUnit,
        muscleGroupSystem: preferences.muscleGroupSystem,
        theme: preferences.theme,
        plateauThreshold: preferences.plateauThreshold,
      });
    }
  }, [preferences]);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Account Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <Label className="text-muted-foreground text-xs">Name</Label>
            <p className="text-sm font-medium">{session.data?.user.name}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs">Email</Label>
            <p className="text-sm font-medium">{session.data?.user.email}</p>
          </div>
          <Separator className="my-4" />
          <Button
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => navigate({ to: "/" }),
                },
              });
            }}
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>

      {/* Preferences Form */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-6"
          >
            {/* Weight Unit */}
            <div>
              <Label className="text-sm font-semibold">Weight Unit</Label>
              <form.Field name="weightUnit">
                {(field) => (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {WEIGHT_UNITS.map((unit) => (
                      <button
                        key={unit.value}
                        type="button"
                        onClick={() => field.handleChange(unit.value)}
                        className={`flex cursor-pointer items-center gap-2 border p-3 text-left text-sm transition-colors hover:bg-muted ${
                          field.state.value === unit.value
                            ? "border-primary bg-primary/5"
                            : ""
                        }`}
                      >
                        {unit.label}
                      </button>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>

            {/* Distance Unit */}
            <div>
              <Label className="text-sm font-semibold">Distance Unit</Label>
              <form.Field name="distanceUnit">
                {(field) => (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {DISTANCE_UNITS.map((unit) => (
                      <button
                        key={unit.value}
                        type="button"
                        onClick={() => field.handleChange(unit.value)}
                        className={`flex cursor-pointer items-center gap-2 border p-3 text-left text-sm transition-colors hover:bg-muted ${
                          field.state.value === unit.value
                            ? "border-primary bg-primary/5"
                            : ""
                        }`}
                      >
                        {unit.label}
                      </button>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>

            {/* Muscle Group System */}
            <div>
              <Label className="text-sm font-semibold">Muscle Group Categorization</Label>
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

            {/* Theme */}
            <div>
              <Label className="text-sm font-semibold">Theme</Label>
              <form.Field name="theme">
                {(field) => (
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    {THEMES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => field.handleChange(t.value)}
                        className={`flex cursor-pointer items-center justify-center border p-3 text-sm transition-colors hover:bg-muted ${
                          field.state.value === t.value
                            ? "border-primary bg-primary/5"
                            : ""
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>

            {/* Plateau Threshold */}
            <div>
              <Label className="text-sm font-semibold">Plateau Detection Threshold</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Number of sessions without progress before flagging a plateau (1-20)
              </p>
              <form.Field name="plateauThreshold">
                {(field) => (
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    className="mt-2 w-24"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                  />
                )}
              </form.Field>
            </div>

            {/* Save Button */}
            <form.Subscribe>
              {(state) => (
                <Button
                  type="submit"
                  disabled={!state.canSubmit || state.isSubmitting || saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

Note: The `React` import needs to be added at the top for the `useEffect`. The exact import will be `import React from "react"` or just `import { useEffect } from "react"` depending on project conventions. Looking at `apps/web/src/components/onboarding/onboarding-page.tsx:4`, the project uses named imports: `import { useState, useCallback } from "react"`.

#### 2. Add Settings link to the web header
**File**: `apps/web/src/components/header.tsx`
**Changes**: Add `/settings` to the `links` array.

```typescript
const links = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/workouts", label: "Workouts" },
  { to: "/settings", label: "Settings" },
] as const;
```

#### 3. Regenerate route tree
After creating `apps/web/src/routes/settings.tsx`, run the TanStack Router code generation so `routeTree.gen.ts` picks up the new route.

```bash
pnpm --filter web dev
# or the specific codegen command if available
```

The route tree auto-generates when the dev server starts or files change. For CI, ensure `routeTree.gen.ts` is committed after generation.

### Success Criteria:

#### Automated Verification:
- [ ] Route tree regenerated: `apps/web/src/routeTree.gen.ts` includes `/settings`
- [ ] TypeScript compiles: `pnpm --filter web exec tsc --noEmit`
- [ ] Build succeeds: `pnpm --filter web build`

#### Manual Verification:
- [ ] Navigate to `/settings` while logged in -- page renders with current preference values pre-filled
- [ ] Navigate to `/settings` while logged out -- redirects to `/login`
- [ ] Change a preference (e.g., weight unit), click Save -- toast appears, value persists on reload
- [ ] Click Sign Out -- redirects to home, session is cleared
- [ ] Plateau threshold input enforces 1-20 range

---

## Phase 3: Native Settings Screen

### Overview
Add a Settings screen inside the drawer navigation. Uses `useState` + Zod validation (matching the native onboarding pattern).

### Changes Required:

#### 1. Create the native settings screen
**File**: `apps/native/app/(drawer)/settings.tsx` (new file)
**Changes**: New screen inside the drawer with preference editing and sign-out.

```typescript
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button, Surface, Spinner, Input } from "heroui-native";
import { useThemeColor } from "heroui-native";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc } from "@/utils/trpc";
import {
  settingsFormSchema,
  WEIGHT_UNITS,
  DISTANCE_UNITS,
  MUSCLE_GROUP_SYSTEMS,
  THEMES,
} from "@src/shared";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 8,
  },
  accountField: {
    marginBottom: 12,
  },
  accountLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginBottom: 2,
  },
  accountValue: {
    fontSize: 16,
    fontWeight: "500",
  },
  grid2: {
    flexDirection: "row",
    gap: 12,
  },
  grid3: {
    flexDirection: "row",
    gap: 12,
  },
  card: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardFull: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 14,
  },
  cardLabelBold: {
    fontSize: 14,
    fontWeight: "500",
  },
  cardDescription: {
    fontSize: 12,
    opacity: 0.7,
  },
  thresholdInput: {
    width: 80,
    marginTop: 8,
  },
});

export default function SettingsScreen() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");
  const borderColor = useThemeColor("border");
  const tintColor = useThemeColor("link");

  const { data: preferences, isLoading } = useQuery(
    trpc.preferences.get.queryOptions()
  );

  // Form state
  const [weightUnit, setWeightUnit] = useState("lbs");
  const [distanceUnit, setDistanceUnit] = useState("mi");
  const [muscleGroupSystem, setMuscleGroupSystem] = useState("bodybuilding");
  const [theme, setTheme] = useState("auto");
  const [plateauThreshold, setPlateauThreshold] = useState(3);

  // Sync form state when preferences load
  useEffect(() => {
    if (preferences) {
      setWeightUnit(preferences.weightUnit);
      setDistanceUnit(preferences.distanceUnit);
      setMuscleGroupSystem(preferences.muscleGroupSystem);
      setTheme(preferences.theme);
      setPlateauThreshold(preferences.plateauThreshold);
    }
  }, [preferences]);

  const saveMutation = useMutation(
    trpc.preferences.upsert.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        Alert.alert("Success", "Settings saved");
      },
      onError: (error: any) => {
        Alert.alert("Error", error.message || "Failed to save settings");
      },
    })
  );

  const handleSave = () => {
    const data = {
      weightUnit,
      distanceUnit,
      muscleGroupSystem,
      theme,
      plateauThreshold,
    };

    const result = settingsFormSchema.safeParse(data);
    if (!result.success) {
      const firstError = result.error.issues[0];
      Alert.alert("Validation Error", firstError?.message ?? "Invalid input");
      return;
    }

    saveMutation.mutate(result.data);
  };

  const handleSignOut = () => {
    authClient.signOut();
    queryClient.invalidateQueries();
    router.replace("/(drawer)");
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor, justifyContent: "center", alignItems: "center" }]}>
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Account Section */}
        <Surface variant="secondary" style={{ padding: 20 }}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Account</Text>
          <View style={styles.accountField}>
            <Text style={[styles.accountLabel, { color: textColor }]}>Name</Text>
            <Text style={[styles.accountValue, { color: textColor }]}>
              {session?.user.name}
            </Text>
          </View>
          <View style={styles.accountField}>
            <Text style={[styles.accountLabel, { color: textColor }]}>Email</Text>
            <Text style={[styles.accountValue, { color: textColor }]}>
              {session?.user.email}
            </Text>
          </View>
          <Button onPress={handleSignOut} variant="secondary" color="danger" style={{ marginTop: 8 }}>
            <Button.Label>Sign Out</Button.Label>
          </Button>
        </Surface>

        {/* Preferences Section */}
        <Surface variant="secondary" style={{ padding: 20 }}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Preferences</Text>

          {/* Weight Unit */}
          <Text style={[styles.label, { color: textColor }]}>Weight Unit</Text>
          <View style={styles.grid2}>
            {WEIGHT_UNITS.map((unit) => {
              const isSelected = weightUnit === unit.value;
              return (
                <Pressable
                  key={unit.value}
                  onPress={() => setWeightUnit(unit.value)}
                  style={[
                    styles.card,
                    {
                      borderColor: isSelected ? tintColor : borderColor,
                      backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                    },
                  ]}
                >
                  <Text style={[styles.cardLabel, { color: textColor }]}>{unit.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Distance Unit */}
          <Text style={[styles.label, { color: textColor, marginTop: 24 }]}>Distance Unit</Text>
          <View style={styles.grid2}>
            {DISTANCE_UNITS.map((unit) => {
              const isSelected = distanceUnit === unit.value;
              return (
                <Pressable
                  key={unit.value}
                  onPress={() => setDistanceUnit(unit.value)}
                  style={[
                    styles.card,
                    {
                      borderColor: isSelected ? tintColor : borderColor,
                      backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                    },
                  ]}
                >
                  <Text style={[styles.cardLabel, { color: textColor }]}>{unit.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Muscle Group System */}
          <Text style={[styles.label, { color: textColor, marginTop: 24 }]}>
            Muscle Group Categorization
          </Text>
          <View style={{ gap: 12 }}>
            {MUSCLE_GROUP_SYSTEMS.map((sys) => {
              const isSelected = muscleGroupSystem === sys.value;
              return (
                <Pressable
                  key={sys.value}
                  onPress={() => setMuscleGroupSystem(sys.value)}
                  style={[
                    styles.cardFull,
                    {
                      borderColor: isSelected ? tintColor : borderColor,
                      backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                    },
                  ]}
                >
                  <Text style={[styles.cardLabelBold, { color: textColor }]}>{sys.label}</Text>
                  <Text style={[styles.cardDescription, { color: textColor }]}>
                    {sys.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Theme */}
          <Text style={[styles.label, { color: textColor, marginTop: 24 }]}>Theme</Text>
          <View style={styles.grid3}>
            {THEMES.map((t) => {
              const isSelected = theme === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setTheme(t.value)}
                  style={[
                    styles.card,
                    {
                      borderColor: isSelected ? tintColor : borderColor,
                      backgroundColor: isSelected ? `${tintColor}10` : backgroundColor,
                    },
                  ]}
                >
                  <Text style={[styles.cardLabel, { color: textColor }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Plateau Threshold */}
          <Text style={[styles.label, { color: textColor, marginTop: 24 }]}>
            Plateau Detection Threshold
          </Text>
          <Text style={[styles.helperText, { color: textColor }]}>
            Sessions without progress before flagging a plateau (1-20)
          </Text>
          <Input
            keyboardType="number-pad"
            value={String(plateauThreshold)}
            onChangeText={(text) => {
              const num = parseInt(text, 10);
              if (!isNaN(num)) {
                setPlateauThreshold(Math.min(20, Math.max(1, num)));
              } else if (text === "") {
                setPlateauThreshold(1);
              }
            }}
            style={styles.thresholdInput}
          />

          {/* Save Button */}
          <Button
            onPress={handleSave}
            style={{ marginTop: 24 }}
            isDisabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Button.Label>Save Changes</Button.Label>
            )}
          </Button>
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Note on `Input` component**: The native onboarding uses React Native's `TextInput` directly inside step-metrics. Check whether `heroui-native` exports an `Input`. If not, use `TextInput` from `react-native` directly. The implementation agent should verify this at build time and swap accordingly.

#### 2. Register Settings in the drawer layout
**File**: `apps/native/app/(drawer)/_layout.tsx`
**Changes**: Add a `Drawer.Screen` for "settings" after the existing screens.

Add this inside the `<Drawer>` component, after the `(tabs)` screen (after line 98):

```typescript
<Drawer.Screen
  name="settings"
  options={{
    headerTitle: "Settings",
    drawerLabel: ({ color, focused }) => (
      <Text style={{ color: focused ? color : themeColorForeground }}>Settings</Text>
    ),
    drawerIcon: ({ size, color, focused }) => (
      <Ionicons
        name="settings-outline"
        size={size}
        color={focused ? color : themeColorForeground}
      />
    ),
  }}
/>
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `pnpm --filter native exec tsc --noEmit` (or Expo's equivalent type-check)
- [ ] Web still builds: `pnpm --filter web build`

#### Manual Verification:
- [ ] Open the native app drawer -- "Settings" item appears with gear icon
- [ ] Tap Settings -- screen shows current preferences pre-filled and account info
- [ ] Change a preference and tap Save -- alert confirms success, value persists after navigating away and back
- [ ] Tap Sign Out -- returns to home, session cleared
- [ ] Plateau threshold input only accepts numbers 1-20

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that both platforms work correctly before proceeding to Phase 4.

---

## Phase 4: Polish and Edge Cases

### Overview
Handle edge cases and small UX improvements.

### Changes Required:

#### 1. Dirty-form indicator on web
**File**: `apps/web/src/routes/settings.tsx`
**Changes**: Use `form.Subscribe` to show a visual indicator or disable the save button when there are no changes. Track `isDirty` from `form.state.isDirty` and only enable the Save button when `isDirty` is true.

#### 2. Invalidate related queries on save
**File**: Both `apps/web/src/routes/settings.tsx` and `apps/native/app/(drawer)/settings.tsx`
**Changes**: After a successful save, invalidate any queries that depend on preferences (e.g., analytics, workout display). The simplest approach is `queryClient.invalidateQueries()` to clear all caches (the native app already does this on sign-out).

On web, update the `onSuccess` callback:
```typescript
onSuccess: () => {
  toast.success("Settings saved");
  queryClient.invalidateQueries();
},
```

#### 3. Handle sign-out confirmation (optional polish)
On native, consider adding an `Alert.alert` confirmation before signing out:
```typescript
const handleSignOut = () => {
  Alert.alert("Sign Out", "Are you sure you want to sign out?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Sign Out",
      style: "destructive",
      onPress: () => {
        authClient.signOut();
        queryClient.invalidateQueries();
        router.replace("/(drawer)");
      },
    },
  ]);
};
```

### Success Criteria:

#### Automated Verification:
- [ ] Both apps build cleanly: `pnpm build`

#### Manual Verification:
- [ ] Web: Save button is disabled when no changes have been made (if dirty-form tracking is implemented)
- [ ] Web: After saving settings, dashboard and workout pages reflect new unit preferences
- [ ] Native: Sign-out shows confirmation dialog before proceeding
- [ ] Both: Rapidly clicking Save does not cause duplicate mutations (button disabled during pending)

---

## Testing Strategy

### Unit Tests:
- `settingsFormSchema` validates correctly (min/max on plateauThreshold, enum values)
- Invalid enum values are rejected
- Edge cases: plateauThreshold of 0, 21, non-integer

### Integration Tests:
- `preferences.upsert` with only settings fields (no onboarding fields) succeeds
- `preferences.get` returns the updated values after upsert

### Manual Testing Steps:
1. Complete onboarding, navigate to settings -- all values match what was set during onboarding
2. Change weight unit from lbs to kg, save, navigate to a workout -- weights display in kg
3. Set plateauThreshold to boundary values (1 and 20) -- both save correctly
4. Sign out from settings, sign back in -- preferences are still persisted
5. Open settings on both web and native simultaneously -- both show same values

## Performance Considerations

- The `preferences.get` query is lightweight (single row by userId primary key). No caching concerns.
- Form re-initialization via `useEffect` on `preferences` data is a one-time cost per page load.
- `queryClient.invalidateQueries()` on save is broad but acceptable -- it ensures all stale data is refreshed. If performance becomes a concern, narrow it to specific query keys.

## Migration Notes

- No database migrations required. The `user_preferences` table already has all needed columns including `plateauThreshold`.
- No breaking API changes. The `preferences.upsert` endpoint already accepts the settings fields.
- The route tree (`routeTree.gen.ts`) will need regeneration after adding the settings route file.

## References

- Preferences router: `packages/api/src/routers/preferences.ts`
- Preferences schema: `packages/shared/src/onboarding-schemas.ts`
- DB schema: `packages/db/src/schema/user-preferences.ts`
- Web onboarding (pattern reference): `apps/web/src/components/onboarding/onboarding-page.tsx`
- Native onboarding (pattern reference): `apps/native/app/onboarding.tsx`
- Web auth guard pattern: `apps/web/src/routes/dashboard.tsx:14-33`
- Web header nav: `apps/web/src/components/header.tsx`
- Native drawer layout: `apps/native/app/(drawer)/_layout.tsx`
- Auth clients: `apps/web/src/lib/auth-client.ts`, `apps/native/lib/auth-client.ts`
