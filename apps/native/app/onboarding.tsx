import React, { useState } from "react";
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Surface, Spinner } from "heroui-native";
import { useThemeColor } from "heroui-native";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc } from "@/utils/trpc";
import { TOTAL_STEPS, stepGoalsSchema, stepWorkoutsSchema, stepPreferencesSchema } from "@src/shared";
import OnboardingProgress from "@/components/onboarding/onboarding-progress";
import StepGoals from "@/components/onboarding/step-goals";
import StepWorkouts from "@/components/onboarding/step-workouts";
import StepMetrics from "@/components/onboarding/step-metrics";
import StepPreferences from "@/components/onboarding/step-preferences";

const onboardingStyles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    padding: 24,
    gap: 24,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
  card: {
    padding: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  buttonFlex: {
    flex: 1,
  },
});

export default function OnboardingScreen() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const backgroundColor = useThemeColor("background");
  const textColor = useThemeColor("foreground");

  // Redirect to home if not authenticated
  React.useEffect(() => {
    if (!session?.user) {
      router.replace("/(drawer)");
    }
  }, [session, router]);

  // Step state
  const [currentStep, setCurrentStep] = useState(0);

  // Form state - Step 1
  const [fitnessGoal, setFitnessGoal] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");

  // Form state - Step 2
  const [preferredWorkoutTypes, setPreferredWorkoutTypes] = useState<string[]>([]);

  // Form state - Step 3
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [birthYear, setBirthYear] = useState<number | undefined>(undefined);
  const [heightCm, setHeightCm] = useState<number | undefined>(undefined);
  const [weightKg, setWeightKg] = useState<number | undefined>(undefined);

  // Form state - Step 4
  const [weightUnit, setWeightUnit] = useState("lbs");
  const [distanceUnit, setDistanceUnit] = useState("mi");
  const [muscleGroupSystem, setMuscleGroupSystem] = useState("bodybuilding");
  const [theme, setTheme] = useState("auto");

  // Error state
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Mutation
  const upsertPreferences = useMutation(trpc.preferences.upsert.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries();
      router.replace("/(drawer)");
    },
    onError: (error: any) => {
      Alert.alert("Error", error.message || "Failed to save preferences");
    },
  }));

  // Validation functions
  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 0) {
      const result = stepGoalsSchema.safeParse({ fitnessGoal, experienceLevel });
      if (!result.success) {
        result.error.issues.forEach((err: any) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
      }
    } else if (step === 1) {
      const result = stepWorkoutsSchema.safeParse({ preferredWorkoutTypes });
      if (!result.success) {
        result.error.issues.forEach((err: any) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
      }
    } else if (step === 2) {
      // Step 3: Preferences - validate required fields
      const result = stepPreferencesSchema.safeParse({
        weightUnit,
        distanceUnit,
        muscleGroupSystem,
        theme,
      });
      if (!result.success) {
        result.error.issues.forEach((err: any) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
      }
    } else if (step === 3) {
      // Step 4: Metrics - all optional, no validation needed
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Navigation handlers
  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => prev - 1);
    setErrors({});
  };

  const handleSubmit = () => {
    if (validateStep(currentStep)) {
      upsertPreferences.mutate({
        fitnessGoal: fitnessGoal as any,
        experienceLevel: experienceLevel as any,
        preferredWorkoutTypes: preferredWorkoutTypes as any,
        gender: gender as any,
        birthYear,
        heightCm,
        weightKg,
        weightUnit: weightUnit as any,
        distanceUnit: distanceUnit as any,
        muscleGroupSystem: muscleGroupSystem as any,
        theme: theme as any,
        plateauThreshold: 2, // Default value
        onboardingCompleted: true,
      });
    }
  };

  // Render current step
  const renderStep = () => {
    if (currentStep === 0) {
      return (
        <StepGoals
          fitnessGoal={fitnessGoal}
          setFitnessGoal={setFitnessGoal}
          experienceLevel={experienceLevel}
          setExperienceLevel={setExperienceLevel}
          errors={errors}
        />
      );
    }

    if (currentStep === 1) {
      return (
        <StepWorkouts
          selectedTypes={preferredWorkoutTypes}
          setSelectedTypes={setPreferredWorkoutTypes}
          errors={errors}
        />
      );
    }

    if (currentStep === 2) {
      return (
        <StepPreferences
          weightUnit={weightUnit}
          setWeightUnit={setWeightUnit}
          distanceUnit={distanceUnit}
          setDistanceUnit={setDistanceUnit}
          muscleGroupSystem={muscleGroupSystem}
          setMuscleGroupSystem={setMuscleGroupSystem}
          theme={theme}
          setTheme={setTheme}
          errors={errors}
        />
      );
    }

    if (currentStep === 3) {
      return (
        <StepMetrics
          gender={gender}
          setGender={setGender}
          birthYear={birthYear}
          setBirthYear={setBirthYear}
          heightCm={heightCm}
          setHeightCm={setHeightCm}
          weightKg={weightKg}
          setWeightKg={setWeightKg}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          errors={errors}
        />
      );
    }

    return null;
  };

  if (!session?.user) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={[onboardingStyles.keyboardAvoidingView, { backgroundColor }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={onboardingStyles.scrollView}
        contentContainerStyle={onboardingStyles.scrollViewContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={onboardingStyles.header}>
          <Text style={[onboardingStyles.title, { color: textColor }]}>
            {"Set Up Your Profile"}
          </Text>
          <Text style={[onboardingStyles.subtitle, { color: textColor }]}>
            {"Let's personalize your fitness experience"}
          </Text>
        </View>

        <OnboardingProgress currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        <Surface variant="secondary" style={onboardingStyles.card}>
          {renderStep()}
        </Surface>

        <View style={onboardingStyles.buttonRow}>
          {currentStep > 0 ? (
            <Button
              onPress={handleBack}
              variant="secondary"
              style={onboardingStyles.buttonFlex}
              isDisabled={upsertPreferences.isPending}
            >
              <Button.Label>{"Back"}</Button.Label>
            </Button>
          ) : null}

          {currentStep < TOTAL_STEPS - 1 ? (
            <Button
              onPress={handleNext}
              style={currentStep > 0 ? onboardingStyles.buttonFlex : undefined}
            >
              <Button.Label>{"Next"}</Button.Label>
            </Button>
          ) : (
            <Button
              onPress={handleSubmit}
              style={onboardingStyles.buttonFlex}
              isDisabled={upsertPreferences.isPending}
            >
              {upsertPreferences.isPending ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Button.Label>{"Complete Setup"}</Button.Label>
              )}
            </Button>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
