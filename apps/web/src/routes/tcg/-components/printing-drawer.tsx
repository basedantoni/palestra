import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import { PRICE_RANGES, rangeStart, type PriceRange } from "@life-tracker/api/lib/market/market-price";
import { compactUsd, tick } from "@/components/finance/balance-line";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { shortDay, usd } from "./tile-price";

type Drawer = RouterOutputs["tcg"]["market"]["printing"];
type Condition = keyof Drawer["ranges"];
type Marketplace = Drawer["grid"][number]["marketplace"];

/** The Printing a drawer is open on: what the tile (or any other opener) already knows. */
export type DrawerPrinting = { printingId: string; variantId: string; language: string };

const MARKETPLACES: Record<Marketplace, { label: string; color: string }> = {
  tcgplayer: { label: "TCGplayer", color: "var(--chart-cat-blue)" },
  cardtrader: { label: "CardTrader", color: "var(--chart-cat-orange)" },
};
const ECB_URL = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

const money = (currency: string, amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);

/**
 * The Printing drawer (KOI-370): the one place holding a Printing's Price History, with a
 * Marketplace × Condition grid of Current Market Prices. Open while `printing` is set.
 */
export function PrintingDrawer({ printing, onClose }: { printing: DrawerPrinting | null; onClose: () => void }) {
  return (
    <Sheet open={printing !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full space-y-5 overflow-y-auto p-5 data-[side=right]:sm:max-w-xl">
        {printing && (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="text-base">
                {printing.variantId} · {printing.language.toUpperCase()}
              </SheetTitle>
            </SheetHeader>
            {/* Keyed so each Printing opens on NM, 1M. */}
            <DrawerBody key={printing.printingId} printingId={printing.printingId} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ printingId }: { printingId: string }) {
  const [range, setRange] = useState<PriceRange>("1M");
  const [condition, setCondition] = useState<Condition>("NM");
  const { data, isPlaceholderData } = useQuery({
    ...trpc.tcg.market.printing.queryOptions({ printingId, range }),
    placeholderData: keepPreviousData,
  });
  if (!data) return <p className="text-xs text-muted-foreground">Loading Price History…</p>;

  const ranges = data.ranges[condition];
  const series = data.series.filter((s) => s.condition === condition);
  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={condition}
            onValueChange={(next) => {
              setCondition(next as Condition);
              // A range the new Condition's history doesn't reach falls back to the default.
              if (!data.ranges[next as Condition][range]) setRange("1M");
            }}
          >
            <TabsList aria-label="Condition">
              {(Object.keys(data.ranges) as Condition[]).map((c) => (
                <TabsTrigger key={c} value={c}>
                  {c}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={range} onValueChange={(next) => setRange(next as PriceRange)}>
            <TabsList aria-label="Range">
              {(Object.keys(PRICE_RANGES) as PriceRange[]).map((r) => (
                <TabsTrigger key={r} value={r} disabled={!ranges[r]}>
                  {r}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className={isPlaceholderData ? "opacity-50" : undefined}>
          {series.length > 0 ? (
            <PriceHistoryChart
              series={series}
              offers={data.offers}
              pricesPaid={data.pricesPaid}
              from={rangeStart(range, data.today)}
              today={data.today}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No {condition} Price History in this range.</p>
          )}
        </div>
      </section>
      <MarketGrid grid={data.grid} />
      <footer className="border-t border-border pt-3 text-[11px] text-muted-foreground">
        USD converted at the{" "}
        <a href={ECB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          European Central Bank euro reference rates
        </a>
        : the chart at each day's rate, the grid at today's.
      </footer>
    </>
  );
}

type ChartPoint = { x: number; y: number; day: string; label: string; native?: string; color: string };

/**
 * One USD line per Marketplace, never blended, joined only across gaps of 7 days or less (the
 * server's segments). Tooltips come only from the real points (and Offers), never the lines; my
 * Offers are dots on their seen date, my prices paid dashed lines.
 */
function PriceHistoryChart({
  series,
  offers,
  pricesPaid,
  from,
  today,
}: {
  series: Drawer["series"];
  offers: Drawer["offers"];
  pricesPaid: number[];
  /** The range's first day; null for All, which starts at the first point shown. */
  from: string | null;
  today: string;
}) {
  const lines = series.map((s) => {
    const { label, color } = MARKETPLACES[s.marketplace];
    const toPoint = (p: (typeof s.segments)[number][number]): ChartPoint => ({
      x: Date.parse(p.day),
      y: p.usd,
      day: p.day,
      label,
      native: s.currency === "USD" ? undefined : money(s.currency, p.price),
      color,
    });
    return { s, color, segments: s.segments.map((seg) => seg.map(toPoint)) };
  });
  const offerPoints: ChartPoint[] = offers.map((o) => ({
    x: Date.parse(o.seenOn),
    y: o.price,
    day: o.seenOn,
    label: "My Offer",
    color: "var(--foreground)",
  }));
  const xs = [...lines.flatMap((l) => l.segments.flat()), ...offerPoints].map((p) => p.x);
  const domain = [from ? Date.parse(from) : Math.min(...xs), Date.parse(today)];

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {lines.map(({ s, color }) => (
          <li key={s.marketplace} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
            {MARKETPLACES[s.marketplace].label}
          </li>
        ))}
        {offers.length > 0 && <li>◆ My Offers</li>}
        {pricesPaid.length > 0 && <li>– – Paid</li>}
      </ul>
      <div role="img" aria-label="Price History">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              type="number"
              dataKey="x"
              scale="time"
              domain={domain}
              allowDataOverflow
              tickFormatter={(ms: number) => shortDay(new Date(ms).toISOString().slice(0, 10))}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tick={tick}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={["auto", "auto"]}
              tickFormatter={(n: number) => compactUsd.format(n)}
              tickLine={false}
              axisLine={false}
              width={48}
              tick={tick}
            />
            {/* Real points stay small hover targets under the lines; Offers stand out. */}
            <ZAxis zAxisId="point" range={[14, 14]} />
            <ZAxis zAxisId="offer" range={[70, 70]} />
            <Tooltip
              shared={false}
              cursor={false}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ChartPoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="size-2 rounded-sm" style={{ background: p.color }} />
                      {p.label} · {shortDay(p.day)}
                    </div>
                    <div className="tabular-nums">
                      {usd.format(p.y)}
                      {p.native && <span className="text-muted-foreground"> · {p.native}</span>}
                    </div>
                  </div>
                );
              }}
            />
            {[...new Set(pricesPaid)].map((paid) => (
              <ReferenceLine key={paid} y={paid} stroke="var(--muted-foreground)" strokeDasharray="4 3" ifOverflow="extendDomain" />
            ))}
            {lines.flatMap(({ s, color, segments }) =>
              segments.map((segment) => (
                <Line
                  key={`${s.marketplace}:${segment[0]!.day}`}
                  data={segment}
                  dataKey="y"
                  type="linear"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  tooltipType="none"
                  legendType="none"
                  isAnimationActive={false}
                />
              )),
            )}
            {lines.map(({ s, color, segments }) => (
              <Scatter
                key={s.marketplace}
                data={segments.flat()}
                dataKey="y"
                zAxisId="point"
                fill={color}
                shape="circle"
                isAnimationActive={false}
              />
            ))}
            {offerPoints.length > 0 && (
              <Scatter
                data={offerPoints}
                dataKey="y"
                zAxisId="offer"
                fill="var(--foreground)"
                shape="diamond"
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Current Market Prices by Marketplace × Condition: native currency, plus USD at today's rate. */
function MarketGrid({ grid }: { grid: Drawer["grid"] }) {
  if (grid.length === 0) return <p className="text-xs text-muted-foreground">No Market Prices for this Printing yet.</p>;
  const rows = Map.groupBy(grid, (c) => c.marketplace);
  const conditions = [...new Set(grid.map((c) => c.condition))];
  return (
    <table className="w-full table-fixed text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="w-24" />
          {conditions.map((c) => (
            <th key={c} scope="col" className="px-1 py-1 text-left font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...rows].map(([marketplace, cells]) => (
          <tr key={marketplace} className="border-t border-border align-top">
            <th scope="row" className="py-1.5 text-left font-medium">
              {MARKETPLACES[marketplace].label}
            </th>
            {cells.map(({ condition, currency, current }) => (
              <td key={condition} className="px-1 py-1.5">
                {current ? (
                  <div className="flex flex-col">
                    <span className="font-medium tabular-nums">{money(currency, current.price)}</span>
                    {currency !== "USD" && current.usd !== null && (
                      <span className="tabular-nums text-muted-foreground">{usd.format(current.usd)}</span>
                    )}
                    {current.listingCount !== null && (
                      <span className="text-muted-foreground">
                        {current.listingCount} {current.listingCount === 1 ? "listing" : "listings"}
                      </span>
                    )}
                    {current.asOf && <span className="text-muted-foreground">as of {shortDay(current.day)}</span>}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
