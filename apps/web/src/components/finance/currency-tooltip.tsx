import { cn } from "@/lib/utils";

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "+$1,200" / "-$300"; zero unsigned. */
export function signedUsd(n: number): string {
  return (n > 0 ? "+" : "") + usd.format(n);
}

export interface CurrencyTooltipRow {
  label: string;
  value: number;
  /** Swatch matching the series color, e.g. "var(--chart-income)". */
  color?: string;
  /** Show +/- and color negatives destructive (for Net-like values). */
  signed?: boolean;
}

/**
 * Tooltip body shared by the finance charts. Render it from a recharts
 * `<Tooltip content={...} />` callback, mapping the hovered datum to rows:
 *
 *   content={({ active, payload }) => {
 *     const d = payload?.[0]?.payload;
 *     return active && d ? <CurrencyTooltip title={...} rows={[...]} /> : null;
 *   }}
 */
export function CurrencyTooltip({ title, note, rows }: { title: string; note?: string; rows: CurrencyTooltipRow[] }) {
  return (
    <div className="rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">
        {title}
        {note && <span className="font-normal text-muted-foreground"> · {note}</span>}
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && <span className="size-2 rounded-sm" style={{ background: r.color }} />}
              {r.label}
            </dt>
            <dd className={cn("text-right tabular-nums", r.signed && r.value < 0 && "text-destructive")}>
              {r.signed ? signedUsd(r.value) : usd.format(r.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
