import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useThemeColor, Spinner } from "heroui-native";
import React, { useCallback, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

function DrawerLayout() {
  const router = useRouter();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const { data: session } = authClient.useSession();
  const { data: isComplete, isLoading } = useQuery(
    trpc.preferences.isOnboardingComplete.queryOptions()
  );

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  // Redirect to onboarding if incomplete
  useEffect(() => {
    if (session && isComplete === false) {
      router.replace("/onboarding");
    }
  }, [session, isComplete, router]);

  // Show loading state while checking onboarding status
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: themeColorBackground,
        }}
      >
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <Drawer
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: "Home",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Home</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <Ionicons
              name="home-outline"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="(tabs)"
        options={{
          headerTitle: "Tabs",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Tabs</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="border-bottom"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable className="mr-4">
                <Ionicons name="add-outline" size={24} color={themeColorForeground} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Drawer.Screen
        name="templates"
        options={{
          headerTitle: "Templates",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>
              Templates
            </Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <Ionicons
              name="copy-outline"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
