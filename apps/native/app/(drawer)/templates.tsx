import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Card, Chip } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/workout-utils";

export default function TemplatesScreen() {
  const templates = useQuery(trpc.templates.list.queryOptions());

  return (
    <Container className="flex-1">
      <ScrollView className="flex-1">
        <View className="p-6">
          <Text className="text-2xl font-bold text-foreground mb-4">Templates</Text>

          {templates.isLoading ? (
            <Text className="text-muted text-center py-8">Loading templates...</Text>
          ) : templates.data && templates.data.length > 0 ? (
            <View className="gap-3">
              {templates.data.map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => router.push(`/template-detail/${template.id}`)}
                >
                  <Card variant="secondary" className="p-4">
                    <Text className="text-base font-semibold text-foreground">
                      {template.name}
                    </Text>
                    <View className="flex-row items-center gap-2 mt-2">
                      <Chip variant="secondary" size="sm">
                        <Chip.Label>
                          {WORKOUT_TYPE_LABELS[template.workoutType] ||
                            template.workoutType}
                        </Chip.Label>
                      </Chip>
                      <Chip variant="secondary" size="sm">
                        <Chip.Label>
                          {template.isSystemTemplate ? "System" : "Personal"}
                        </Chip.Label>
                      </Chip>
                    </View>
                    <Text className="text-xs text-muted mt-3">
                      Tap to view and edit
                    </Text>
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text className="text-muted text-center py-8">No templates found.</Text>
          )}
        </View>
      </ScrollView>
    </Container>
  );
}
