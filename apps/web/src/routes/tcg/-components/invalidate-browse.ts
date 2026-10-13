import type { QueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/** Refetch browse after anything that changes an Artwork's flags or which Section counts it. */
export const invalidateBrowse = (queryClient: QueryClient) =>
  Promise.all(
    [trpc.tcg.artworks.pathKey(), trpc.tcg.artworkSections.pathKey()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
