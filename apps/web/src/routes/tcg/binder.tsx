import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { binderSheet } from "@life-tracker/shared";
import { useEffect } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { BinderSheet } from "./-components/binder-sheet";
import { CollectionValue } from "./-components/copy-value";

// The sheet lives in the URL so a reload or a shared link opens the same page.
const binderSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute("/tcg/binder")({
  validateSearch: (search) => binderSearchSchema.parse(search),
  component: BinderPage,
  beforeLoad: async ({ cause }) => {
    // Flipping a page only changes the search: the session was checked on entering, and re-checking
    // would hold every flip on a network round trip.
    if (cause === "stay") return;
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

/** The Copies held as a binder: one Copy per Pocket in card-number order, one 9-Pocket sheet at a time. */
function BinderPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: copies, isLoading, isError } = useQuery(trpc.tcg.copies.list.queryOptions());
  const sheet = binderSheet(copies ?? [], search.page ?? 1);
  const flip = (page: number) =>
    navigate({ search: { page: Math.min(sheet.pages, Math.max(1, page)) }, replace: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while typing or in an open menu, and not Cmd/Ctrl+[ ], which are the browser's Back/Forward.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable], [role="menu"]')) return;
      if (e.key === "[") flip(sheet.page - 1);
      if (e.key === "]") flip(sheet.page + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h1 className="text-2xl font-bold">Binder</h1>
          <CollectionValue />
        </div>
        <div className="flex gap-4">
          <Link to="/tcg" className="text-sm underline underline-offset-4">
            Cards
          </Link>
          <Link to="/tcg/copies" className="text-sm underline underline-offset-4">
            My Copies
          </Link>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn't load your collection.</p>
      ) : !copies?.length ? (
        <p className="text-sm text-muted-foreground">
          No Copies yet. Add one from an Artwork on{" "}
          <Link to="/tcg" className="underline">
            browse
          </Link>
          .
        </p>
      ) : (
        // The route sizes the sheet only to clamp flips; BinderSheet orders the Pockets.
        <BinderSheet page={sheet.page} onFlip={flip} onArtist={(artist) => navigate({ to: "/tcg", search: { artist } })} />
      )}
    </div>
  );
}
