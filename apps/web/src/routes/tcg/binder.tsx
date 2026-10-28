import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { binderSheet, TCG_ARTWORKS_MAX_LIMIT } from "@life-tracker/shared";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { useArtworkCards } from "./-components/artwork-card";
import { artworkImage } from "./-components/card-image";
import { useTilePrices } from "./-components/tile-price";

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

/** The collection as a binder: owned Artworks in card-number order, one 9-pocket sheet at a time. */
function BinderPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: owned, isLoading, isError } = useQuery(
    trpc.tcg.artworks.queryOptions({ owned: true, limit: TCG_ARTWORKS_MAX_LIMIT }),
  );
  const { renderCard, dialogs } = useArtworkCards((artist) => navigate({ to: "/tcg", search: { artist } }));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sheet = binderSheet(owned ?? [], search.page ?? 1);
  const filled = sheet.pockets.filter((a) => a !== null);
  // A flip leaves the old selection behind: fall back to the sheet's first pocket.
  const selected = filled.find((a) => a.variantId === selectedId) ?? filled[0];
  const prices = useTilePrices(filled);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Binder</h1>
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
      ) : !filled.length ? (
        <p className="text-sm text-muted-foreground">
          No Copies yet. Add one from an Artwork on{" "}
          <Link to="/tcg" className="underline">
            browse
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="mx-auto grid max-w-md grid-cols-3 gap-3 rounded-xl border border-border bg-muted p-4 shadow-inner">
              {sheet.pockets.map((a, i) => {
                if (!a) return <div key={i} className="aspect-[63/88] rounded-sm border border-dashed border-border" />;
                const name = `${a.variantId} ${a.nameEn ?? a.nameJa ?? ""}`;
                return (
                  <button
                    key={a.variantId}
                    type="button"
                    aria-label={name}
                    aria-pressed={selected?.variantId === a.variantId}
                    title={name}
                    onClick={() => setSelectedId(a.variantId)}
                    className={`aspect-[63/88] overflow-hidden rounded-sm bg-background transition ${
                      selected?.variantId === a.variantId ? "ring-2 ring-primary" : "hover:scale-[1.02]"
                    }`}
                  >
                    <img src={artworkImage(a.printings)} alt="" className="size-full object-cover" />
                  </button>
                );
              })}
            </div>
            <div className="mx-auto flex max-w-md items-center gap-3">
              <Button size="sm" variant="outline" aria-label="Previous page" disabled={sheet.page === 1} onClick={() => flip(sheet.page - 1)}>
                ◀
              </Button>
              <input
                type="range"
                aria-label="Binder page"
                min={1}
                max={sheet.pages}
                value={sheet.page}
                onChange={(e) => flip(Number(e.target.value))}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                aria-label="Next page"
                disabled={sheet.page === sheet.pages}
                onClick={() => flip(sheet.page + 1)}
              >
                ▶
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Page {sheet.page} of {sheet.pages} · {filled[0]!.variantId} → {filled.at(-1)!.variantId} · [ / ] to flip
            </p>
          </div>
          <aside className="md:sticky md:top-4 md:self-start">{selected && <ul>{renderCard(selected, prices)}</ul>}</aside>
        </div>
      )}
      {dialogs}
    </div>
  );
}
