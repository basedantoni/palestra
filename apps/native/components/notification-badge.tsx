import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { trpc } from "@/utils/trpc";

export function NotificationBadge() {
  const { data: unreadCount = 0 } = useQuery(
    trpc.notifications.unreadCount.queryOptions(undefined, {
      refetchInterval: 30_000,
    }),
  );

  if (unreadCount === 0) {
    return null;
  }

  return (
    <View className="bg-destructive rounded-full h-5 w-5 items-center justify-center">
      <Text className="text-destructive-foreground text-[10px] font-bold">
        {unreadCount > 9 ? "9+" : unreadCount}
      </Text>
    </View>
  );
}
