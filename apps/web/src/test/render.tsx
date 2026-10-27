/**
 * Render a component from typed router-output fixtures, with no live tRPC and no network (KOI-363).
 *
 * A component that takes data as props: type the fixture as the procedure's output and pass it.
 *
 *   const rows: RouterOutputs["budgets"]["history"] = [...];
 *   renderWithData(<MonthlyBars data={rows} color="red" />);
 *
 * A component that runs `useQuery(trpc.x.queryOptions(input))`: seed that query's cache entry.
 * `trpc.x.queryKey(input)` carries the output type, so `setQueryData` type-checks the fixture.
 *
 *   renderWithData(<CardFundPanel />, (client) => {
 *     client.setQueryData(trpc.tcg.fund.get.queryKey(), fundFixture);
 *   });
 *
 * Seeded data never goes stale, so nothing refetches. A query the test did not seed would fetch,
 * and fetch is stubbed to reject (src/test/setup.ts).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderWithData(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  seed?.(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
