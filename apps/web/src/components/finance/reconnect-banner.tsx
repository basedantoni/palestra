import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/** A Plaid item is healthy only while active; anything else needs the user's attention. */
function needsAttention(status: string): boolean {
  return status !== "active";
}

const STATUS_MESSAGE: Record<string, string> = {
  error: "needs to be reconnected",
  pending_expiration: "access is expiring soon — please reconnect",
  revoked: "access was revoked — please reconnect",
};

/**
 * Shows a banner when any linked institution's connection is unhealthy
 * (driven by plaid_item.status, set from ITEM webhooks).
 */
export function ReconnectBanner() {
  const { data: items } = useQuery(trpc.plaid.listItems.queryOptions());
  const broken = (items ?? []).filter((i) => needsAttention(i.status));
  if (broken.length === 0) return null;

  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {broken.map((i) => (
        <div key={i.id}>
          {i.institutionName ?? "A bank"} {STATUS_MESSAGE[i.status] ?? "needs to be reconnected"}.
        </div>
      ))}
    </div>
  );
}
