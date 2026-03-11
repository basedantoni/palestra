import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const isAuthenticated = !!session;

  const { data: unreadCount = 0 } = useQuery(
    trpc.notifications.unreadCount.queryOptions(undefined, {
      enabled: isAuthenticated,
      refetchInterval: isAuthenticated ? 30_000 : false,
    }),
  );

  const { data: notifications = [] } = useQuery(
    trpc.notifications.list.queryOptions(undefined, {
      enabled: isAuthenticated,
    }),
  );

  const invalidateNotifications = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.notifications.unreadCount.queryOptions().queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.notifications.list.queryOptions().queryKey,
    });
  };

  const markReadMutation = useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: invalidateNotifications,
    }),
  );

  const markAllReadMutation = useMutation(
    trpc.notifications.markAllRead.mutationOptions({
      onSuccess: () => {
        toast.success("All notifications marked as read");
        invalidateNotifications();
      },
    }),
  );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative h-9 w-9" />
        }
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
        <span className="sr-only">Notifications</span>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 ? (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Mark all as read
            </button>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  className={`w-full px-3 py-3 text-left transition-colors hover:bg-muted ${
                    notif.readAt ? "opacity-60" : "font-medium"
                  }`}
                  onClick={() => {
                    if (!notif.readAt) {
                      markReadMutation.mutate({ id: notif.id });
                    }
                  }}
                >
                  <div className="text-xs font-semibold">{notif.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {notif.message}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(notif.createdAt), {
                      addSuffix: true,
                    })}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
