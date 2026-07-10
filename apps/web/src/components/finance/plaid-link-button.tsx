import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePlaidLink } from "react-plaid-link";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/**
 * Launches Plaid Link to connect a bank, then exchanges the public token and
 * refreshes the accounts list. Fetches the link token on mount so Link is ready
 * by the time the user clicks.
 *
 * If the link-token request fails (e.g. Plaid misconfiguration), the button
 * surfaces the error and offers a retry instead of sitting permanently
 * disabled with no feedback.
 */
export function PlaidLinkButton() {
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const createLinkToken = useMutation(
    trpc.plaid.createLinkToken.mutationOptions({
      onSuccess: (data) => setLinkToken(data.linkToken),
    }),
  );

  const exchange = useMutation(
    trpc.plaid.exchangePublicToken.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.plaid.listAccounts.queryOptions().queryKey,
        });
        setLinkToken(null);
      },
    }),
  );

  // Fetch a link token once on mount.
  useEffect(() => {
    createLinkToken.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSuccess = useCallback(
    (publicToken: string) => {
      exchange.mutate({ publicToken });
    },
    [exchange],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  // Token request failed → show the error and let the user retry.
  if (createLinkToken.isError) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="destructive" onClick={() => createLinkToken.mutate()}>
          Retry connect
        </Button>
        <span className="text-xs text-destructive">
          {createLinkToken.error.message}
        </span>
      </div>
    );
  }

  const loadingToken = !linkToken && (createLinkToken.isPending || !ready);

  return (
    <Button
      onClick={() => open()}
      disabled={loadingToken || !ready || exchange.isPending}
    >
      {exchange.isPending
        ? "Connecting…"
        : loadingToken
          ? "Loading…"
          : "Connect a bank"}
    </Button>
  );
}
