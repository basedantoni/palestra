import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePlaidLink } from "react-plaid-link";

import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { trpc } from "@/utils/trpc";

export type ReconnectState =
  | "idle"
  | "opening"
  | "in_link"
  | "syncing"
  | "done"
  | "cancelled"
  | "failed";

export const RECONNECT_MESSAGE: Record<Exclude<ReconnectState, "idle">, string> = {
  opening: "Opening secure sign-in…",
  in_link: "Waiting for you to finish signing in…",
  syncing: "Reconnected — syncing transactions…",
  done: "Back in sync.",
  cancelled: "Sign-in was cancelled. Your data is still paused.",
  failed: "Your bank returned an error. Try again in a few minutes.",
};

export function isReconnecting(state: ReconnectState): boolean {
  return state === "opening" || state === "in_link" || state === "syncing";
}

/**
 * Repairs a broken Plaid connection: fetches an update-mode Link token for the
 * item, opens Plaid Link, and on success marks the item repaired. The server
 * syncs before answering, so "done" means the catch-up data has landed.
 */
export function useReconnectBank(plaidItemId: string) {
  const invalidateFinance = useInvalidateFinance();
  const [state, setState] = useState<ReconnectState>("idle");
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const createLinkToken = useMutation(
    trpc.plaid.createLinkToken.mutationOptions({
      onSuccess: (data) => setLinkToken(data.linkToken),
      onError: () => setState("failed"),
    }),
  );

  const markRepaired = useMutation(
    trpc.plaid.markItemRepaired.mutationOptions({
      onSuccess: () => setState("done"),
      onError: () => setState("failed"),
      onSettled: invalidateFinance,
    }),
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    // Update mode: no public token to exchange — the existing access token works again.
    onSuccess: () => {
      setLinkToken(null);
      setState("syncing");
      markRepaired.mutate({ plaidItemId });
    },
    onExit: (error) => {
      setLinkToken(null);
      setState(error ? "failed" : "cancelled");
    },
  });

  // "Back in sync." is a transient confirmation, not a lasting state.
  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(t);
  }, [state]);

  // Open Link as soon as the update-mode token is loaded.
  useEffect(() => {
    if (linkToken && ready) {
      setState("in_link");
      open();
    }
  }, [linkToken, ready, open]);

  const start = () => {
    setState("opening");
    createLinkToken.mutate({ plaidItemId });
  };

  return { state, start };
}
