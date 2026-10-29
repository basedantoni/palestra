import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PRICE_RANGES, type PriceRange } from "@life-tracker/api/lib/market/market-price";
import { BalanceLineChart } from "@/components/finance/balance-line";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { shortDay, usd } from "./market-format";
import { PrintingDrawer } from "./printing-drawer";
import { Sparkline } from "./tile-price";

export type CopyRow = RouterOutputs["tcg"]["copies"]["list"][number];

const signedUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
const signedPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });

const gainClass = (gain: number) =>
  cn("tabular-nums", gain > 0 && "text-green-600 dark:text-green-400", gain < 0 && "text-destructive");

/**
 * A Copy's Value (KOI-374): dated once its price is over 7 days old, "priced at" when it comes from a
 * better Condition, "Unpriced" when there is none. Its Gain shows when it has a price paid; with
 * `sparkline`, the last 30 days. Clicking the value opens the Printing drawer.
 */
export function CopyValue({ copy, sparkline = true }: { copy: CopyRow; sparkline?: boolean }) {
  const [open, setOpen] = useState(false);
  const { value, gain } = copy;
  if (!value) return <span className="text-xs text-muted-foreground">Unpriced</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-1 text-xs">
      <button
        type="button"
        className="flex flex-wrap items-baseline gap-1 rounded-sm text-left underline-offset-2 hover:underline"
        title="Copy Value: the lowest Current Market Price at this Condition or better"
        onClick={() => setOpen(true)}
      >
        <span className="font-medium tabular-nums">{usd.format(value.usd)}</span>
        {value.pricedAt !== copy.condition && <span className="text-muted-foreground">priced at {value.pricedAt}</span>}
        {value.asOf && <span className="text-muted-foreground">as of {shortDay(value.day)}</span>}
        {sparkline && <Sparkline segments={copy.sparkline} label="30-day Copy Value" />}
      </button>
      {gain !== null && (
        <span className={gainClass(gain)} title="Gain vs price paid">
          {signedUsd.format(gain)}
        </span>
      )}
      {/* Outside the button: React events bubble through the portal, so a close click would reopen it. */}
      <PrintingDrawer printing={open ? copy : null} onClose={() => setOpen(false)} />
    </span>
  );
}

/**
 * A Binder pocket's price sticker (KOI-375): the held Copy's Value, dated once stale, "—" when
 * unpriced. No Gain. Clicking it opens the Printing drawer.
 */
export function CopySticker({ copy }: { copy: CopyRow }) {
  const [open, setOpen] = useState(false);
  const { value } = copy;
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <>
      <button
        type="button"
        className="flex flex-wrap items-baseline justify-center gap-1 rounded-sm text-xs underline-offset-2 hover:underline"
        title={`Copy Value, ${copy.language.toUpperCase()} ${copy.condition}${value.pricedAt === copy.condition ? "" : `, priced at ${value.pricedAt}`}`}
        onClick={() => setOpen(true)}
      >
        <span className="font-medium tabular-nums">{usd.format(value.usd)}</span>
        {value.asOf && <span className="text-muted-foreground">as of {shortDay(value.day)}</span>}
      </button>
      <PrintingDrawer printing={open ? copy : null} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Collection Value (KOI-374): today's total over priced Copies with coverage, the total Gain vs
 * paid, and its history over a range.
 */
export function CollectionTile() {
  const [range, setRange] = useState<PriceRange>("1M");
  const { data, isPlaceholderData } = useQuery({
    ...trpc.tcg.market.collectionHistory.queryOptions({ range }),
    placeholderData: keepPreviousData,
  });
  if (!data || data.copies === 0) return null;
  return (
    <section className="space-y-2 border border-border p-3" aria-label="Collection Value">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <ValueAndCoverage data={data} />
        {data.gain && (
          <span className="text-xs" title={`Over ${data.gain.copies} Copies with a value and a price paid`}>
            <span className={gainClass(data.gain.usd)}>
              {signedUsd.format(data.gain.usd)}
              {data.gain.percent !== null && ` (${signedPercent.format(data.gain.percent / 100)})`}
            </span>{" "}
            vs paid
          </span>
        )}
        <Tabs className="ml-auto" value={range} onValueChange={(next) => setRange(next as PriceRange)}>
          <TabsList aria-label="Range">
            {(Object.keys(PRICE_RANGES) as PriceRange[]).map((r) => (
              <TabsTrigger key={r} value={r}>
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {data.points.length > 1 && (
        <BalanceLineChart
          rows={data.points.map((p) => ({ date: p.day, value: p.usd }))}
          series={[{ key: "value", label: "Collection Value", color: "var(--chart-cat-blue)" }]}
          dimmed={isPlaceholderData}
        />
      )}
    </section>
  );
}

type CollectionHistory = RouterOutputs["tcg"]["market"]["collectionHistory"];

function ValueAndCoverage({ data }: { data: CollectionHistory }) {
  return (
    <>
      <span className="text-xl font-semibold tabular-nums">{data.value ? usd.format(data.value.usd) : "—"}</span>
      <span className="text-xs text-muted-foreground">
        {data.value?.priced ?? 0} of {data.copies} Copies priced
      </span>
    </>
  );
}

/**
 * Collection Value with coverage for the Binder header (KOI-375): My Copies' default query, so the
 * two always agree. No Gain, which stays on My Copies.
 */
export function CollectionValue() {
  const { data } = useQuery(trpc.tcg.market.collectionHistory.queryOptions({ range: "1M" }));
  if (!data || data.copies === 0) return null;
  return (
    <div role="group" className="flex items-baseline gap-2" aria-label="Collection Value">
      <ValueAndCoverage data={data} />
    </div>
  );
}

/** An owned Artwork's tile price: each held Copy's Value, by its Printing and Condition. `selectedId`'s row is marked. */
export function HeldCopyValues({ copies, selectedId }: { copies: CopyRow[]; selectedId?: string }) {
  return copies.map((c) => (
    <div
      key={c.id}
      aria-current={c.id === selectedId || undefined}
      className={cn("flex flex-wrap items-baseline gap-1 text-xs", c.id === selectedId && "rounded-sm bg-accent px-1 font-medium")}
    >
      <span className="text-muted-foreground">
        {c.language.toUpperCase()} {c.condition}
      </span>
      <CopyValue copy={c} sparkline={false} />
    </div>
  ));
}
