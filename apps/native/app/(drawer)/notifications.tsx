import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

export default function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery(
    trpc.notifications.list.queryOptions(),
  );

  const invalidateNotifications = () => {
    void queryClient.invalidateQueries();
  };

  const markReadMutation = useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: invalidateNotifications,
    }),
  );

  const markAllReadMutation = useMutation(
    trpc.notifications.markAllRead.mutationOptions({
      onSuccess: invalidateNotifications,
    }),
  );

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <Container className="flex-1">
      <View className="flex-1">
        {/* Header actions */}
        {unreadCount > 0 ? (
          <View className="px-4 py-3 border-b border-border flex-row justify-end">
            <Pressable
              onPress={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <Text className="text-primary text-sm">Mark all as read</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="flex-1 justify-center items-center">
            <Text className="text-muted-foreground">Loading...</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View className="flex-1 justify-center items-center px-4">
            <Text className="text-muted-foreground text-center">
              No notifications yet.
            </Text>
          </View>
        ) : (
          notifications.map((notif) => (
            <Pressable
              key={notif.id}
              className={`px-4 py-4 border-b border-border ${notif.readAt ? "opacity-60" : ""}`}
              onPress={() => {
                if (!notif.readAt) {
                  markReadMutation.mutate({ id: notif.id });
                }
              }}
            >
              <Text
                className={`text-foreground text-sm ${!notif.readAt ? "font-semibold" : ""}`}
              >
                {notif.title}
              </Text>
              <Text className="text-muted-foreground text-xs mt-0.5">
                {notif.message}
              </Text>
              <Text className="text-muted-foreground text-xs mt-1">
                {new Date(notif.createdAt).toLocaleDateString()}
              </Text>
            </Pressable>
          ))
        )}
      </View>
    </Container>
  );
}
