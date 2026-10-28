import { useQuery } from "@tanstack/react-query";

import { trpc, type RouterOutputs } from "@/utils/trpc";

export type TilePrices = RouterOutputs["tcg"]["market"]["tilePrices"];

/** Tile prices for the Artworks on screen, in one request; undefined until loaded. */
export function useTilePrices(artworks: Array<{ variantId: string }> | undefined) {
  const variantIds = artworks?.map((a) => a.variantId) ?? [];
  return useQuery({ ...trpc.tcg.market.tilePrices.queryOptions({ variantIds }), enabled: variantIds.length > 0 }).data;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * The English Printing's Current Market Price on a tile (TCGplayer, NM, USD): dated once older than
 * 7 days, a dash when there is none. Never carried forward or estimated. Its 7d Price Move and
 * 30-day sparkline show only when there is data for them.
 */
export function TilePrice({ price }: { price: TilePrices[number] | undefined }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1 text-xs" title="TCGplayer Market Price, NM">
      <span className="text-muted-foreground">EN</span>
      {price ? (
        <>
          <span className="font-medium tabular-nums">{usd.format(price.price)}</span>
          {price.asOf && <span className="text-muted-foreground">as of {shortDay(price.day)}</span>}
          {price.move7d !== null && (
            <span
              className={`tabular-nums ${price.move7d > 0 ? "text-green-600" : price.move7d < 0 ? "text-destructive" : "text-muted-foreground"}`}
              title="7d Price Move"
            >
              {percent.format(price.move7d / 100)}
            </span>
          )}
          <Sparkline segments={price.sparkline} />
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** Real points only: one line per segment (gaps over 7 days break it), a dot for a lone point. */
function Sparkline({ segments }: { segments: TilePrices[number]["sparkline"] }) {
  const points = segments.flat();
  if (points.length < 2) return null;
  const first = Date.parse(points[0]!.day);
  const span = Date.parse(points.at(-1)!.day) - first;
  const prices = points.map((p) => p.price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const xy = (p: (typeof points)[number]) =>
    `${((Date.parse(p.day) - first) / span) * 100},${hi === lo ? 10 : 20 - ((p.price - lo) / (hi - lo)) * 20}`;
  return (
    <svg
      role="img"
      aria-label="30-day Market Price"
      viewBox="-2 -2 104 24"
      preserveAspectRatio="none"
      className="h-4 w-16 self-center text-muted-foreground"
    >
      {segments.map((s) => (
        <polyline
          key={s[0]!.day}
          points={(s.length > 1 ? s : [s[0]!, s[0]!]).map(xy).join(" ")}
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
