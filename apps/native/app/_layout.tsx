import "@/global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider } from "@/contexts/app-theme-context";
import { queryClient } from "@/utils/trpc";

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

function StackLayout() {
  return (
    <Stack screenOptions={{}}>
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ title: "Modal", presentation: "modal" }} />
      <Stack.Screen
        name="new-workout"
        options={{ title: "New Workout", presentation: "modal", headerShown: false }}
      />
      <Stack.Screen
        name="workout-detail/[id]"
        options={{ title: "Workout", headerShown: true }}
      />
      <Stack.Screen
        name="template-detail/[id]"
        options={{ title: "Template", headerShown: true }}
      />
    </Stack>
  );
}

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <BottomSheetModalProvider>
                <StackLayout />
              </BottomSheetModalProvider>
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
