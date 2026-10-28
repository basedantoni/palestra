import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

import { UnmatchedProducts } from "./-components/unmatched-products";

export const Route = createFileRoute("/admin/market")({
  component: AdminMarketPage,
});

function AdminMarketPage() {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useQuery(trpc.admin.market.unmatchedProducts.queryOptions());
  const match = useMutation(
    trpc.admin.market.setManualMatch.mutationOptions({
      onSuccess: ({ variantId }) => {
        toast.success(variantId ? `Matched to ${variantId}` : "Marked not an Artwork");
        void queryClient.invalidateQueries({ queryKey: trpc.admin.market.unmatchedProducts.queryKey() });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to save the match");
      },
    }),
  );

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Unmatched Marketplace Products</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Products the matcher couldn't place on an Artwork. A manual match applies to past days once they are replayed
          with <code>market:derive</code>.
        </p>
      </div>
      {isLoading || !products ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <UnmatchedProducts
          products={products}
          pending={match.isPending}
          onMatch={(id, variantId) => match.mutate({ id, variantId })}
        />
      )}
    </div>
  );
}
