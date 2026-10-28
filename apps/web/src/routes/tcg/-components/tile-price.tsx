import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { PrintingDrawer } from "./printing-drawer";

export type TilePrices = RouterOutputs["tcg"]["market"]["tilePrices"];

/** Tile prices for the Artworks on screen, in one request; undefined until loaded. */
export function useTilePrices(artworks: Array<{ variantId: string }> | undefined) {
  const variantIds = artworks?.map((a) => a.variantId) ?? [];
  return useQuery({ ...trpc.tcg.market.tilePrices.queryOptions({ variantIds }), enabled: variantIds.length > 0 }).data;
}

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * The English Printing's Current Market Price on a tile (TCGplayer, NM, USD): dated once older than
 * 7 days, a dash when there is none. Never carried forward or estimated. Its 7d Price Move and
 * 30-day sparkline show only when there is data for them. Clicking it opens the Printing drawer.
 */
export function TilePrice({ price }: { price: TilePrices[number] | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-baseline gap-1 text-xs" title="TCGplayer Market Price, NM">
      <span className="text-muted-foreground">EN</span>
      {price ? (
        <button
          type="button"
          className="flex flex-wrap items-baseline gap-1 rounded-sm text-left hover:underline underline-offset-2"
          onClick={() => setOpen(true)}
        >
          <span className="font-medium tabular-nums">{usd.format(price.price)}</span>
          {price.asOf && <span className="text-muted-foreground">as of {shortDay(price.day)}</span>}
          {price.move7d !== null && (
            <span
              className={cn(
                "tabular-nums text-muted-foreground",
                price.move7d > 0 && "text-green-600 dark:text-green-400",
                price.move7d < 0 && "text-destructive",
              )}
              title="7d Price Move"
            >
              {percent.format(price.move7d / 100)}
            </span>
          )}
          <Sparkline segments={price.sparkline} />
        </button>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {/* Outside the button: React events bubble through the portal, so a close click would reopen it. */}
      <PrintingDrawer printing={open && price ? price : null} onClose={() => setOpen(false)} />
    </div>
  );
}

const SPARKLINE_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Real points only, across the last 30 days ending today (UTC, the capture day): one line per
 * segment (gaps over 7 days break it), a dot for a lone point.
 */
function Sparkline({ segments }: { segments: TilePrices[number]["sparkline"] }) {
  const points = segments.flat();
  if (points.length < 2) return null;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const prices = points.map((p) => p.price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const toSvgPoint = (p: (typeof points)[number]) => {
    const x = 100 - ((today - Date.parse(p.day)) / (SPARKLINE_DAYS * DAY_MS)) * 100;
    const y = hi === lo ? 10 : 20 - ((p.price - lo) / (hi - lo)) * 20;
    return `${x},${y}`;
  };
  return (
    <svg
      role="img"
      aria-label="30-day Market Price"
      viewBox="-2 -2 104 24"
      preserveAspectRatio="none"
      className="h-4 w-16 self-center text-muted-foreground"
    >
      {segments.map((segment) => (
        <polyline
          key={segment[0]!.day}
          points={(segment.length > 1 ? segment : [segment[0]!, segment[0]!]).map(toSvgPoint).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
