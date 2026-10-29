import { useQuery } from "@tanstack/react-query";
import { binderPockets, binderSheet, TCG_ARTWORKS_MAX_LIMIT } from "@life-tracker/shared";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import { useArtworkCards } from "./artwork-card";
import { cardImage } from "./card-image";
import { CopySticker } from "./copy-value";
import { shortDay, usd } from "./market-format";
import { PriceHistory } from "./printing-drawer";

/**
 * One Binder sheet of the Copies held, one Copy per Pocket (KOI-379), and the aside for the selected
 * Copy: its Artwork's tile and its Printing's Price History. `onFlip` gets the page asked for.
 */
export function BinderSheet({
  page,
  onFlip,
  onArtist,
}: {
  page: number;
  onFlip: (page: number) => void;
  onArtist: (artist: string) => void;
}) {
  const { data: copies } = useQuery(trpc.tcg.copies.list.queryOptions());
  const { data: owned } = useQuery(trpc.tcg.artworks.queryOptions({ owned: true, limit: TCG_ARTWORKS_MAX_LIMIT }));
  const { renderCard, dialogs } = useArtworkCards(onArtist);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shownPage, setShownPage] = useState(page);
  // Every flip, even back again, opens on the sheet's first Pocket.
  if (page !== shownPage) {
    setShownPage(page);
    setSelectedId(null);
  }

  const sheet = binderSheet(binderPockets(copies ?? []), page);
  const filled = sheet.pockets.filter((c) => c !== null);
  // A Copy gone since it was selected falls back to the first Pocket too.
  const selected = filled.find((c) => c.id === selectedId) ?? filled[0];
  if (!selected) return null;
  const artwork = owned?.find((a) => a.variantId === selected.variantId);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div
          role="group"
          aria-label="Sheet"
          className="mx-auto grid max-w-md grid-cols-3 gap-3 rounded-xl border border-border bg-muted p-4 shadow-inner"
        >
          {sheet.pockets.map((c, i) => {
            if (!c) return <div key={i} className="aspect-[63/88] rounded-sm border border-dashed border-border" />;
            const name = `${c.variantId} ${c.nameEn ?? c.nameJa ?? ""}`;
            return (
              <div key={c.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  aria-label={name}
                  aria-pressed={c.id === selected.id}
                  title={name}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "aspect-[63/88] w-full overflow-hidden rounded-sm bg-background transition",
                    c.id === selected.id ? "ring-2 ring-primary" : "hover:scale-[1.02]",
                  )}
                >
                  <img src={cardImage(c.imageUrl)} alt="" className="size-full object-cover" />
                </button>
                {/* Beside the Pocket, not in it: the sticker is its own button, opening the drawer. */}
                <CopySticker copy={c} />
              </div>
            );
          })}
        </div>
        <div className="mx-auto flex max-w-md items-center gap-3">
          <Button size="sm" variant="outline" aria-label="Previous page" disabled={sheet.page === 1} onClick={() => onFlip(sheet.page - 1)}>
            ◀
          </Button>
          <input
            type="range"
            aria-label="Binder page"
            min={1}
            max={sheet.pages}
            value={sheet.page}
            onChange={(e) => onFlip(Number(e.target.value))}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            aria-label="Next page"
            disabled={sheet.page === sheet.pages}
            onClick={() => onFlip(sheet.page + 1)}
          >
            ▶
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Page {sheet.page} of {sheet.pages} · {filled[0]!.variantId} → {filled.at(-1)!.variantId} · [ / ] to flip
        </p>
      </div>
      <aside className="space-y-4 md:sticky md:top-4 md:self-start">
        {artwork && <ul>{renderCard(artwork, undefined, selected.id)}</ul>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            {selected.language.toUpperCase()} {selected.condition} · acquired {shortDay(selected.acquiredOn)} ·{" "}
            {selected.pricePaid === null ? "no price paid" : `paid ${usd.format(selected.pricePaid)}`}
          </span>
          {selected.belowMinimum && <Badge variant="destructive">Below Want minimum</Badge>}
        </div>
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Price History · {selected.language.toUpperCase()}</h2>
          {/* Keyed so each Copy opens on the Condition its value was priced at (NM when unpriced), 1M. */}
          <PriceHistory key={selected.id} printingId={selected.printingId} condition={selected.value?.pricedAt} />
        </section>
      </aside>
      {dialogs}
    </div>
  );
}
