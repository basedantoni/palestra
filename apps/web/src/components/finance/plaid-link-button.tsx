import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePlaidLink } from "react-plaid-link";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/**
 * Launches Plaid Link to connect a bank, then exchanges the public token and
 * refreshes the accounts list. Fetches the link token on mount so Link is ready
 * by the time the user clicks.
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

  return (
    <Button
      onClick={() => open()}
      disabled={!ready || exchange.isPending}
    >
      {exchange.isPending ? "Connecting…" : "Connect a bank"}
    </Button>
  );
}
