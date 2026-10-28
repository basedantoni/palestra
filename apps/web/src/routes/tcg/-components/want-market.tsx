import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/utils/trpc";

import { cardImage } from "./card-image";
import { shortDay, usd } from "./market-format";
import { PrintingDrawer } from "./printing-drawer";
import { TILE_PRICE_TITLES } from "./tile-price";

/** Market Prices beside Wants and Offers (KOI-373). */
type Want = RouterOutputs["tcg"]["wants"]["list"][number];

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });

/** Each accepted language's NM Current Market Price in USD with its 30-day low–high; "—" with none. */
export function WantMarket({ market }: { market: Want["market"] }) {
  return (
    <div className="flex flex-wrap gap-x-3 text-xs">
      {market.map(({ language, current }) => (
        <span key={language} className="flex items-baseline gap-1" title={TILE_PRICE_TITLES[language]}>
          <span className="text-muted-foreground">{language.toUpperCase()}</span>
          {current ? (
            <>
              <span className="font-medium tabular-nums">{usd.format(current.price)}</span>
              {current.asOf && <span className="text-muted-foreground">as of {shortDay(current.day)}</span>}
              <span className="tabular-nums text-muted-foreground">
                30d {usd.format(current.low)}–{usd.format(current.high)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * An Offer's delivered price against today's NM Current Market Price for its Printing. Muted once
 * the Offer is over 7 days old: the market moved on since it was seen. Nothing without a price.
 */
export function OfferVsMarket({ offer }: { offer: Pick<Want["offers"][number], "seenOn" | "vsMarket"> }) {
  const { vsMarket } = offer;
  if (!vsMarket) return null;
  return (
    <Badge
      variant="outline"
      title={vsMarket.stale ? `Seen ${shortDay(offer.seenOn)} · market as of today` : undefined}
      className={cn(
        "tabular-nums",
        vsMarket.stale
          ? "text-muted-foreground"
          : vsMarket.percent > 0
            ? "text-destructive"
            : vsMarket.percent < 0 && "text-green-600 dark:text-green-400",
      )}
    >
      {percent.format(vsMarket.percent / 100)} vs market
    </Badge>
  );
}

/** A Want's image; clicking it opens the Printing drawer on the pictured Printing. */
export function WantImage({ want }: { want: Pick<Want, "variantId" | "imageUrl" | "pictured"> }) {
  const [open, setOpen] = useState(false);
  const { imageUrl, pictured } = want;
  if (!imageUrl) return null;
  const img = (
    <img src={cardImage(imageUrl)} alt={want.variantId} loading="lazy" className="aspect-[63/88] w-12 rounded-sm bg-muted object-cover" />
  );
  if (!pictured) return img;
  const printing = { printingId: pictured.printingId, variantId: want.variantId, language: pictured.language };
  return (
    <>
      <button
        type="button"
        aria-label={`Price History for ${want.variantId} · ${pictured.language.toUpperCase()}`}
        className="shrink-0 rounded-sm"
        onClick={() => setOpen(true)}
      >
        {img}
      </button>
      <PrintingDrawer printing={open ? printing : null} onClose={() => setOpen(false)} />
    </>
  );
}
