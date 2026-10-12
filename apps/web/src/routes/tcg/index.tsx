import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { env } from "@life-tracker/env/web";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { CopyDialog } from "./-components/copy-dialog";

const VARIANT_KINDS = ["base", "parallel", "manga", "reprint"] as const;
const PAGE = 200;

/** Bandai blocks cross-site image loads, so card images go through the server's relay. */
const cardImage = (src: string) => `${env.VITE_SERVER_URL}/api/tcg/image?src=${encodeURIComponent(src)}`;

// Filters live in the URL so a filtered view survives reloads.
const tcgSearchSchema = z.object({
  character: z.string().optional().catch(undefined),
  set: z.string().optional().catch(undefined),
  kind: z.enum(VARIANT_KINDS).optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  /** Only Artworks the user owns a Copy of: the collection view. */
  owned: z.boolean().optional().catch(undefined),
});

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];

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
  const { data: sets } = useQuery(trpc.tcg.sets.queryOptions());
  const { data: artworks, isLoading } = useQuery({
    ...trpc.tcg.artworks.queryOptions({
      character: search.character,
      set: search.set,
      variantKind: search.kind,
      owned: search.owned,
      limit,
    }),
    placeholderData: keepPreviousData,
  });

  const [adding, setAdding] = useState<ArtworkRow | null>(null);
  const today = useFinanceToday();
  const queryClient = useQueryClient();
  const addCopy = useMutation(
    trpc.tcg.copies.create.mutationOptions({
      onSuccess: () => {
        setAdding(null);
        queryClient.invalidateQueries({ queryKey: trpc.tcg.pathKey() });
      },
    }),
  );

  const update = (next: Partial<z.infer<typeof tcgSearchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, limit: undefined, ...next }), replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cards</h1>
        <Link to="/tcg/copies" className="text-sm underline-offset-4 hover:underline">
          My Copies
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
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={search.owned ?? false}
            onChange={(e) => update({ owned: e.target.checked || undefined })}
          />
          Owned
        </label>
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
                    {a.owned && <Badge>Owned</Badge>}
                  </div>
                  <Button size="xs" variant="outline" onClick={() => setAdding(a)}>
                    Add Copy
                  </Button>
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

      {adding && (
        <CopyDialog
          title={`Add a Copy of ${adding.variantId}`}
          initial={{ printingId: adding.printings[0]!.id, condition: "NM", pricePaid: null, acquiredOn: today }}
          printings={adding.printings}
          pending={addCopy.isPending}
          error={addCopy.error?.message}
          onSubmit={(values) => addCopy.mutate(values)}
          onClose={() => {
            addCopy.reset();
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
