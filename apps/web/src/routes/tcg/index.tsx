import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { cardImage } from "./-components/card-image";
import { WantDialog } from "./-components/want-dialog";
import { ArtRatingSelect, ThemeTagMenu, ThemesDialog } from "./-components/art-taste";

const VARIANT_KINDS = ["base", "parallel", "manga", "reprint"] as const;
const PAGE = 200;

// Filters live in the URL so a filtered view survives reloads.
const tcgSearchSchema = z.object({
  character: z.string().optional().catch(undefined),
  set: z.string().optional().catch(undefined),
  kind: z.enum(VARIANT_KINDS).optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  minRating: z.number().int().min(0).max(5).optional().catch(undefined),
  theme: z.string().uuid().optional().catch(undefined),
  sort: z.enum(["rating"]).optional().catch(undefined),
});

export const Route = createFileRoute("/tcg/")({
  validateSearch: (search) => tcgSearchSchema.parse(search),
  component: TcgPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function TcgPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const limit = search.limit ?? PAGE;
  const [wanting, setWanting] = useState<{ variantId: string; label: string } | null>(null);
  const { data: sets } = useQuery(trpc.tcg.sets.queryOptions());
  const { data: themes } = useQuery(trpc.tcg.themes.queryOptions());
  const { data: artworks, isLoading } = useQuery({
    ...trpc.tcg.artworks.queryOptions({
      character: search.character,
      set: search.set,
      variantKind: search.kind,
      limit,
      minRating: search.minRating,
      themeId: search.theme,
      sort: search.sort,
    }),
    placeholderData: keepPreviousData,
  });

  const update = (next: Partial<z.infer<typeof tcgSearchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, limit: undefined, ...next }), replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cards</h1>
        <Link to="/tcg/wants" className="text-sm underline underline-offset-4">
          Wants
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Character"
          placeholder="Character"
          value={search.character ?? ""}
          onChange={(e) => update({ character: e.target.value || undefined })}
          className="w-48"
        />
        <select
          aria-label="Set"
          value={search.set ?? ""}
          onChange={(e) => update({ set: e.target.value || undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All sets</option>
          {(sets ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Variant kind"
          value={search.kind ?? ""}
          onChange={(e) => update({ kind: (e.target.value || undefined) as (typeof VARIANT_KINDS)[number] | undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All kinds</option>
          {VARIANT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          aria-label="Minimum Art Rating"
          value={search.minRating ?? ""}
          onChange={(e) => update({ minRating: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Any rating</option>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              ★ {n}+
            </option>
          ))}
        </select>
        <select
          aria-label="Theme"
          value={search.theme ?? ""}
          onChange={(e) => update({ theme: e.target.value || undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All Themes</option>
          {(themes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort"
          value={search.sort ?? ""}
          onChange={(e) => update({ sort: e.target.value === "rating" ? "rating" : undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Sort: card number</option>
          <option value="rating">Sort: Art Rating</option>
        </select>
        <ThemesDialog />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !artworks?.length ? (
        <p className="text-sm text-muted-foreground">No Artworks match. Run `pnpm db:import:tcg` if the catalog is empty.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {artworks.map((a) => {
              const image = a.printings.find((p) => p.language === "ja") ?? a.printings[0];
              return (
                <li key={a.variantId} className="space-y-1">
                  {image && (
                    <img
                      src={cardImage(image.imageUrl)}
                      alt={`${a.variantId} ${a.nameEn ?? a.nameJa ?? ""}`}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-sm bg-muted object-cover"
                    />
                  )}
                  <div className="text-xs font-medium">{a.nameEn ?? a.nameJa}</div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span>{a.variantId}</span>
                    <Badge variant="secondary">{a.variantKind}</Badge>
                    {a.printings.map((p) => (
                      <Badge key={p.language} variant="outline" title={p.setName}>
                        {p.language.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {a.wanted && <Badge>Wanted</Badge>}
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setWanting({ variantId: a.variantId, label: a.nameEn ?? a.nameJa ?? a.cardNumber })}
                    >
                      {a.wanted ? "Want another" : "Want"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <ArtRatingSelect variantId={a.variantId} rating={a.rating} />
                    <ThemeTagMenu variantId={a.variantId} tagged={a.themes} />
                    {a.themes.map((t) => (
                      <Badge key={t.id} variant="secondary">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {artworks.length === limit && (
            <Button variant="outline" onClick={() => update({ limit: limit + PAGE })}>
              Show more
            </Button>
          )}
        </>
      )}
      {wanting && <WantDialog {...wanting} onClose={() => setWanting(null)} />}
    </div>
  );
}
