/**
 * PROTOTYPE (KOI-325), throwaway: never merge. Lives on branch prototype/koi-325-market-watch-ui.
 *
 * Question: where does Market Watch show up in the TCG area, and what must the user see at a glance?
 * Three structurally different answers, switched with `?mw=A|B|C` (remembered across TCG pages) and
 * the floating bar at the bottom:
 *   A  Inline everywhere: every existing row and tile carries its own Market Price.
 *   B  Market hub: one new Market page owns charts, collection value and movers; other pages link to it.
 *   C  Printing drawer + pulse: one drawer for any Printing, opened from anywhere; a pulse strip on Cards.
 *
 * All prices are FAKE: a deterministic random walk per Artwork + language, with the v1 Marketplaces from
 * KOI-321/322 (TCGplayer via TCGCSV in USD, single price; CardTrader in EUR, per Condition;
 * PriceCharting in USD, ungraded) and their real history situation (capture-forward, so short).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TCG_CONDITIONS } from "@life-tracker/shared";
import { format, parseISO, subDays } from "date-fns";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/utils/trpc";

import { cardImage } from "./card-image";

// ---------------------------------------------------------------- variant switch

export const VARIANTS = {
  A: "Inline everywhere",
  B: "Market hub",
  C: "Printing drawer + pulse",
} as const;
export type Variant = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Variant[];
const STORAGE = "koi325-mw";
const EVENT = "koi325-mw";

function readVariant(): Variant {
  const fromUrl = new URLSearchParams(window.location.search).get("mw");
  const v = fromUrl ?? localStorage.getItem(STORAGE);
  return KEYS.includes(v as Variant) ? (v as Variant) : "A";
}

function setVariant(v: Variant) {
  localStorage.setItem(STORAGE, v);
  const url = new URL(window.location.href);
  url.searchParams.set("mw", v);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(EVENT));
}

export function useMarketVariant(): Variant {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("popstate", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("popstate", cb);
      };
    },
    readVariant,
    () => "A" as Variant,
  );
}

/** Floating bottom bar: ← variant → . Arrow keys cycle too. Dev builds only. */
export function PrototypeSwitcher() {
  const current = useMarketVariant();
  const cycle = (step: number) => setVariant(KEYS[(KEYS.indexOf(current) + step + KEYS.length) % KEYS.length]!);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-700 px-4 py-2 text-sm text-white shadow-xl">
      <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}>
        ←
      </button>
      <span className="font-mono">
        KOI-325 · {current} ({VARIANTS[current]})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => cycle(1)}>
        →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- fake market data

export type Lang = "ja" | "en" | "zh" | "ko";
export type Condition = (typeof TCG_CONDITIONS)[number];
export type Marketplace = "TCGplayer" | "CardTrader" | "PriceCharting";

const SOURCES: Record<Lang, Marketplace[]> = {
  en: ["TCGplayer", "CardTrader"],
  ja: ["CardTrader", "PriceCharting"],
  zh: ["CardTrader"],
  ko: ["CardTrader"],
};
const CURRENCY: Record<Marketplace, "USD" | "EUR"> = { TCGplayer: "USD", CardTrader: "EUR", PriceCharting: "USD" };
/** Only CardTrader prices each Condition; a single price counts as NM. */
const PER_CONDITION: Record<Marketplace, boolean> = { TCGplayer: false, CardTrader: true, PriceCharting: false };
/** Days of history each Marketplace has. TCGplayer pretends the TCGCSV archive (from 2024-02-08) came back. */
const HISTORY_DAYS: Record<Marketplace, number> = { TCGplayer: 980, CardTrader: 48, PriceCharting: 365 };
const SPREAD: Record<Marketplace, number> = { TCGplayer: 1, CardTrader: 0.9, PriceCharting: 1.06 };
const CONDITION_FACTOR: Record<Condition, number> = { NM: 1, LP: 0.82, MP: 0.64, HP: 0.45, DMG: 0.3 };
const LANG_FACTOR: Record<Lang, number> = { ja: 1, en: 1.35, zh: 0.45, ko: 0.55 };
/** Fake ECB rate. */
const EUR_USD = 1.08;
export const MARKETPLACE_COLOR: Record<Marketplace, string> = {
  TCGplayer: "var(--chart-cat-1)",
  CardTrader: "var(--chart-cat-2)",
  PriceCharting: "var(--chart-cat-3)",
};

export const TODAY = format(new Date(), "yyyy-MM-dd");
const MAX_DAYS = Math.max(...Object.values(HISTORY_DAYS));

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's NM USD price for the seeded Copies and Wants, so gains and Offer comparisons look plausible. */
const ANCHOR: Record<string, number> = {
  "OP01-024:ja": 5.2,
  "OP01-024_p1:ja": 44,
  "OP01-001_p2:en": 31,
  "OP06-007_p1:ja": 71,
  "OP06-022_p2:ja": 38,
  "OP04-011:en": 1.6,
  "OP09-069:en": 2.1,
  "OP04-112_p3:ja": 63,
  "OP07-047_p1:en": 21,
  "OP09-050_p2:ja": 33,
  "OP07-119_p1:ja": 19,
  "OP04-015:ja": 2.2,
  "OP05-119_p1:ja": 78,
  "OP05-119_p1:en": 92,
  "OP07-051_p1:en": 42,
  "OP01-120_p1:ja": 125,
  "OP01-120_p1:en": 148,
};

const walks = new Map<string, number[]>();

/** USD NM price per day, oldest first, ending today. Shared by every Marketplace for this Printing. */
function walk(variantId: string, lang: Lang) {
  const key = `${variantId}:${lang}`;
  const cached = walks.get(key);
  if (cached) return cached;
  const r = rng(hash(key));
  const art = rng(hash(variantId));
  let today = 0.3 * Math.exp(art() * 4.2);
  const parallel = /_p(\d)/.exec(variantId);
  if (parallel) today *= 3 + Number(parallel[1]) * 4 * art();
  today *= LANG_FACTOR[lang];
  today = ANCHOR[key] ?? today;
  const drift = (r() - 0.45) * 0.0016;
  // Some Printings are moving this week, so movers have something to show.
  const shock = r() < 0.18 ? (r() - 0.4) * 0.6 : 0;
  const prices = [today];
  let p = today;
  for (let d = 1; d < MAX_DAYS; d++) {
    let ret = drift + (r() - 0.5) * 0.035;
    if (d <= 5) ret += shock / 5;
    if (r() < 0.004) ret += (r() - 0.5) * 0.3;
    p = p / (1 + ret);
    prices.push(p);
  }
  const series = prices.reverse();
  walks.set(key, series);
  return series;
}

export interface PricePoint {
  date: string;
  native: number;
  usd: number;
}

export function sourcesFor(lang: Lang) {
  return SOURCES[lang];
}

export function currencyOf(m: Marketplace) {
  return CURRENCY[m];
}

export function priceHistory(variantId: string, lang: Lang, m: Marketplace, condition: Condition = "NM"): PricePoint[] {
  const base = walk(variantId, lang);
  const noise = rng(hash(`${variantId}:${lang}:${m}`));
  const factor = SPREAD[m] * (PER_CONDITION[m] ? CONDITION_FACTOR[condition] : 1);
  const days = HISTORY_DAYS[m];
  const start = parseISO(TODAY);
  return base.slice(-days).map((usd, i) => {
    const v = usd * factor * (1 + (noise() - 0.5) * 0.04);
    return {
      date: format(subDays(start, days - 1 - i), "yyyy-MM-dd"),
      usd: v,
      native: CURRENCY[m] === "EUR" ? v / EUR_USD : v,
    };
  });
}

export interface Quote {
  marketplace: Marketplace;
  usd: number;
  native: number;
  currency: "USD" | "EUR";
  since: string;
  change7: number;
  change30: number | null;
  low30: number;
  high30: number;
}

function quoteFrom(m: Marketplace, h: PricePoint[]): Quote {
  const last = h.at(-1)!;
  const at = (n: number) => h.at(-1 - n);
  const month = h.slice(-30).map((p) => p.usd);
  return {
    marketplace: m,
    usd: last.usd,
    native: last.native,
    currency: CURRENCY[m],
    since: h[0]!.date,
    change7: last.usd / at(7)!.usd - 1,
    change30: at(30) ? last.usd / at(30)!.usd - 1 : null,
    low30: Math.min(...month),
    high30: Math.max(...month),
  };
}

/** The Market Price shown at a glance: the language's first Marketplace, NM unless asked. */
export function quote(variantId: string, lang: Lang, condition: Condition = "NM"): Quote {
  const m = SOURCES[lang][0]!;
  return quoteFrom(m, priceHistory(variantId, lang, m, condition));
}

export function quotes(variantId: string, lang: Lang, condition: Condition = "NM"): Quote[] {
  return SOURCES[lang].map((m) => quoteFrom(m, priceHistory(variantId, lang, m, condition)));
}

export interface Holding {
  variantId: string;
  language: Lang;
  condition: Condition;
  pricePaid: number | null;
  acquiredOn: string;
}

/** Collection value per day: each Copy counts from the day it was acquired, at its own Condition. */
export function collectionHistory(copies: Holding[]): Array<{ date: string; value: number; paid: number }> {
  const byDate = new Map<string, { value: number; paid: number }>();
  for (const c of copies) {
    const h = priceHistory(c.variantId, c.language, SOURCES[c.language][0]!, c.condition);
    for (const p of h) {
      if (p.date < c.acquiredOn) continue;
      const row = byDate.get(p.date) ?? { value: 0, paid: 0 };
      row.value += p.usd;
      row.paid += c.pricePaid ?? 0;
      byDate.set(p.date, row);
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
}

// ---------------------------------------------------------------- formatting

export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
export const money = (n: number, currency: "USD" | "EUR") =>
  n.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
export const pct = (n: number) => `${n >= 0 ? "▲" : "▼"} ${Math.abs(n * 100).toFixed(1)}%`;

export function Change({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null) return <span className={`text-muted-foreground ${className}`}>—</span>;
  return (
    <span className={`${value >= 0 ? "text-emerald-600" : "text-red-600"} tabular-nums ${className}`}>{pct(value)}</span>
  );
}

/** An Offer's delivered price against the current Market Price: negative is a deal. */
export function VsMarket({ price, market }: { price: number; market: number }) {
  const d = price / market - 1;
  return (
    <span className={`tabular-nums ${d <= 0 ? "text-emerald-600" : "text-red-600"}`} title={`Market ${usd(market)}`}>
      {d <= 0 ? "−" : "+"}
      {Math.abs(d * 100).toFixed(0)}% vs market
    </span>
  );
}

// ---------------------------------------------------------------- charts

export function Sparkline({ data, width = 64, height = 20 }: { data: number[]; width?: number; height?: number }) {
  const up = data.at(-1)! >= data[0]!;
  return (
    <LineChart width={width} height={height} data={data.map((v) => ({ v }))}>
      <YAxis hide domain={["dataMin", "dataMax"]} />
      <Line dataKey="v" dot={false} strokeWidth={1.25} stroke={up ? "#059669" : "#dc2626"} isAnimationActive={false} />
    </LineChart>
  );
}

const RANGES = { "1M": 30, "3M": 90, "1Y": 365, All: Infinity } as const;
type Range = keyof typeof RANGES;

/**
 * One Printing's Price History: a line per Marketplace, Condition picker for the Marketplaces that price
 * one, range tabs, USD or native currency. `marks` overlays the user's Offers (dots) and Copies (lines).
 */
export function PriceHistoryChart({
  variantId,
  lang,
  height = 240,
  offers = [],
  paid = [],
}: {
  variantId: string;
  lang: Lang;
  height?: number;
  offers?: Array<{ price: number; seenOn: string; seller: string }>;
  paid?: Array<{ price: number; label: string }>;
}) {
  const [range, setRange] = useState<Range>("3M");
  const [condition, setCondition] = useState<Condition>("NM");
  const [native, setNative] = useState(false);
  const sources = SOURCES[lang];
  const [shown, setShown] = useState<Marketplace[]>(sources);
  const cutoff = range === "All" ? "" : format(subDays(parseISO(TODAY), RANGES[range]), "yyyy-MM-dd");

  const byDate = new Map<string, Record<string, number | string>>();
  for (const m of shown) {
    for (const p of priceHistory(variantId, lang, m, condition)) {
      if (p.date < cutoff) continue;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[m] = native ? p.native : p.usd;
      byDate.set(p.date, row);
    }
  }
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const conditionMatters = shown.some((m) => PER_CONDITION[m]);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={(r) => setRange(r as Range)}>
          <TabsList>
            {Object.keys(RANGES).map((r) => (
              <TabsTrigger key={r} value={r}>
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {sources.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={shown.includes(m)}
              onChange={(e) => setShown(e.target.checked ? [...shown, m] : shown.filter((x) => x !== m))}
            />
            <span style={{ color: MARKETPLACE_COLOR[m] }}>●</span> {m}
          </label>
        ))}
        <select
          aria-label="Condition"
          value={condition}
          disabled={!conditionMatters}
          title={conditionMatters ? undefined : "These Marketplaces give a single price, counted as NM"}
          onChange={(e) => setCondition(e.target.value as Condition)}
          className="rounded-md border border-border bg-background px-1 py-0.5 disabled:opacity-50"
        >
          {TCG_CONDITIONS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} />
          native currency
        </label>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), range === "All" || range === "1Y" ? "MMM yy" : "MMM d")}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(n: number) => `${n.toFixed(n < 10 ? 2 : 0)}`}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, background: "var(--popover)", border: "1px solid var(--border)" }}
            formatter={(v, name) => [
              native ? money(Number(v), CURRENCY[name as Marketplace]) : usd(Number(v)),
              String(name),
            ]}
          />
          {shown.map((m) => (
            <Line
              key={m}
              dataKey={m}
              stroke={MARKETPLACE_COLOR[m]}
              strokeWidth={1.75}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {!native &&
            paid.map((p) => (
              <ReferenceLine
                key={p.label}
                y={p.price}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 3"
                label={{ value: p.label, fontSize: 10, fill: "var(--muted-foreground)", position: "insideTopLeft" }}
              />
            ))}
          {!native &&
            offers
              .filter((o) => o.seenOn >= cutoff)
              .map((o, i) => (
                <ReferenceDot key={i} x={o.seenOn} y={o.price} r={4} fill="var(--foreground)" stroke="var(--background)">
                  <title>{`${o.seller}: ${usd(o.price)}`}</title>
                </ReferenceDot>
              ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-muted-foreground">
        {shown.map((m) => `${m} since ${format(parseISO(priceHistory(variantId, lang, m)[0]!.date), "MMM d, yyyy")}`).join(" · ")}
        {" · "}FAKE data, capture-forward
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- shared lookups

/** The dev user's Copies as Holdings, for collection value. */
export function useHoldings() {
  const { data } = useQuery(trpc.tcg.copies.list.queryOptions());
  const holdings: Holding[] = (data ?? []).map((c) => ({
    variantId: c.variantId,
    language: c.language as Lang,
    condition: c.condition as Condition,
    pricePaid: c.pricePaid,
    acquiredOn: c.acquiredOn,
  }));
  return { holdings, copies: data ?? [] };
}

export interface Mover {
  variantId: string;
  name: string;
  lang: Lang;
  imageUrl: string;
  quote: Quote;
  spark: number[];
}

/** Biggest 7-day moves across a slice of the catalog (the prototype ranks what one fetch returns). */
export function useMovers(limit = 600) {
  const { data } = useQuery(trpc.tcg.artworks.queryOptions({ limit }));
  const movers: Mover[] = [];
  for (const a of data ?? []) {
    for (const p of a.printings) {
      const lang = p.language as Lang;
      const q = quote(a.variantId, lang);
      if (q.usd < 2) continue;
      movers.push({
        variantId: a.variantId,
        name: a.nameEn ?? a.nameJa ?? a.cardNumber,
        lang,
        imageUrl: p.imageUrl,
        quote: q,
        spark: priceHistory(a.variantId, lang, q.marketplace).slice(-30).map((x) => x.usd),
      });
    }
  }
  movers.sort((a, b) => b.quote.change7 - a.quote.change7);
  return { gainers: movers.slice(0, 10), losers: movers.slice(-10).reverse(), all: movers };
}

/** One printed price per language, as a compact row: `JA $12.40 ▲4%`. */
export function PriceLine({ variantId, lang, spark = false }: { variantId: string; lang: Lang; spark?: boolean }) {
  const q = quote(variantId, lang);
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <span className="w-5 font-medium text-muted-foreground">{lang.toUpperCase()}</span>
      <span className="font-medium">{usd(q.usd)}</span>
      <Change value={q.change7} className="text-[10px]" />
      {spark && <Sparkline data={priceHistory(variantId, lang, q.marketplace).slice(-30).map((p) => p.usd)} width={44} height={16} />}
    </span>
  );
}

// ---------------------------------------------------------------- variant C: the Printing drawer

export interface DrawerTarget {
  variantId: string;
  lang: Lang;
  name: string;
  imageUrl?: string;
  /** Other languages this Artwork is printed in, to switch between. */
  langs?: Lang[];
}

const drawerListeners = new Set<(t: DrawerTarget | null) => void>();
export const openPrintingDrawer = (t: DrawerTarget) => drawerListeners.forEach((f) => f(t));

/** Mount once per page. Any `openPrintingDrawer` call anywhere opens it. */
export function PrintingDrawer() {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [lang, setLang] = useState<Lang>("ja");
  useEffect(() => {
    const f = (t: DrawerTarget | null) => {
      setTarget(t);
      if (t) setLang(t.lang);
    };
    drawerListeners.add(f);
    return () => void drawerListeners.delete(f);
  }, []);
  const { copies } = useHoldings();
  const { data: wants } = useQuery(trpc.tcg.wants.list.queryOptions({ status: "open" }));
  if (!target) return null;
  const mine = copies.filter((c) => c.variantId === target.variantId && c.language === lang && c.pricePaid != null);
  const offers = (wants ?? [])
    .filter((w) => w.variantId === target.variantId)
    .flatMap((w) => w.offers.filter((o) => o.language === lang));
  const nm = quotes(target.variantId, lang, "NM");

  return (
    <Sheet open onOpenChange={(o) => !o && setTarget(null)}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {target.name} · {target.variantId}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="flex gap-4">
            {target.imageUrl && (
              <img src={cardImage(target.imageUrl)} alt="" className="aspect-[63/88] w-28 rounded-sm bg-muted object-cover" />
            )}
            <div className="flex-1 space-y-2">
              {(target.langs?.length ?? 0) > 1 && (
                <Tabs value={lang} onValueChange={(l) => setLang(l as Lang)}>
                  <TabsList>
                    {target.langs!.map((l) => (
                      <TabsTrigger key={l} value={l}>
                        {l.toUpperCase()}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              <div className="text-3xl font-semibold tabular-nums">{usd(nm[0]!.usd)}</div>
              <div className="text-xs text-muted-foreground">
                NM Market Price on {nm[0]!.marketplace} · <Change value={nm[0]!.change7} /> 7d ·{" "}
                <Change value={nm[0]!.change30} /> 30d
              </div>
              <ConditionGrid variantId={target.variantId} lang={lang} />
            </div>
          </div>
          <PriceHistoryChart
            variantId={target.variantId}
            lang={lang}
            height={260}
            offers={offers}
            paid={mine.map((c) => ({ price: c.pricePaid!, label: `You paid ${usd(c.pricePaid!)} (${c.condition})` }))}
          />
          {offers.length > 0 && (
            <div className="space-y-1 text-xs">
              <div className="font-medium">Your Offers (dots on the chart)</div>
              {offers.map((o) => (
                <div key={o.id} className="flex justify-between">
                  <span>{o.seller}</span>
                  <span className="flex gap-2">
                    {usd(o.price)} <VsMarket price={o.price} market={nm[0]!.usd} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Marketplace × Condition, native currency with USD under it. Single-price Marketplaces fill NM only. */
export function ConditionGrid({ variantId, lang }: { variantId: string; lang: Lang }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-normal">Marketplace</th>
          {TCG_CONDITIONS.map((c) => (
            <th key={c} className="text-right font-normal">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SOURCES[lang].map((m) => (
          <tr key={m}>
            <td style={{ color: MARKETPLACE_COLOR[m] }}>{m}</td>
            {TCG_CONDITIONS.map((c) => {
              if (!PER_CONDITION[m] && c !== "NM") return <td key={c} className="text-right text-muted-foreground">·</td>;
              const p = priceHistory(variantId, lang, m, c).at(-1)!;
              return (
                <td key={c} className="text-right">
                  {money(p.native, CURRENCY[m])}
                  {CURRENCY[m] !== "USD" && <div className="text-[10px] text-muted-foreground">{usd(p.usd)}</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A 30-day market band with the Offer and the Market Price marked on it. */
export function RangeBar({ price, q }: { price: number; q: Quote }) {
  const lo = Math.min(q.low30, price) * 0.95;
  const hi = Math.max(q.high30, price) * 1.05;
  const at = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <span className="relative inline-block h-3 w-28 rounded bg-muted" title={`30d ${usd(q.low30)}–${usd(q.high30)}`}>
      <span
        className="absolute inset-y-0 rounded bg-emerald-200 dark:bg-emerald-900"
        style={{ left: at(q.low30), right: `calc(100% - ${at(q.high30)})` }}
      />
      <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: at(q.usd) }} />
      <span
        className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${price <= q.usd ? "bg-emerald-600" : "bg-red-600"}`}
        style={{ left: at(price) }}
      />
    </span>
  );
}

// ---------------------------------------------------------------- collection value

export function CollectionValueChart({ height = 200 }: { height?: number }) {
  const { holdings } = useHoldings();
  const [range, setRange] = useState<Range>("1Y");
  const cutoff = range === "All" ? "" : format(subDays(parseISO(TODAY), RANGES[range]), "yyyy-MM-dd");
  const rows = collectionHistory(holdings).filter((r) => r.date >= cutoff);
  return (
    <div className="space-y-2">
      <Tabs value={range} onValueChange={(r) => setRange(r as Range)}>
        <TabsList>
          {Object.keys(RANGES).map((r) => (
            <TabsTrigger key={r} value={r}>
              {r}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), "MMM yy")}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tickFormatter={(n: number) => `$${Math.round(n)}`}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, background: "var(--popover)", border: "1px solid var(--border)" }}
            formatter={(v, name) => [usd(Number(v)), name === "value" ? "Market value" : "Paid"]}
          />
          <Line dataKey="paid" type="stepAfter" stroke="var(--muted-foreground)" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line dataKey="value" stroke="var(--foreground)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function useCollectionValue() {
  const { holdings } = useHoldings();
  const h = collectionHistory(holdings);
  const now = h.at(-1);
  const monthAgo = h.at(-31);
  return {
    value: now?.value ?? 0,
    paid: holdings.reduce((s, c) => s + (c.pricePaid ?? 0), 0),
    change30: now && monthAgo ? now.value / monthAgo.value - 1 : null,
    spark: h.slice(-90).map((r) => r.value),
    unpriced: holdings.filter((c) => c.pricePaid == null).length,
  };
}

export function CollectionValueTile({ compact = false, footer }: { compact?: boolean; footer?: ReactNode }) {
  const v = useCollectionValue();
  if (!v.spark.length) return null;
  return (
    <div className={`flex items-center gap-3 rounded-md border border-border ${compact ? "px-3 py-1.5" : "p-3"}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Collection value</div>
        <div className={`${compact ? "text-base" : "text-2xl"} font-semibold tabular-nums`}>{usd(v.value)}</div>
        <div className="text-xs">
          <Change value={v.change30} /> 30d · paid {usd(v.paid)}
        </div>
        {footer}
      </div>
      <Sparkline data={v.spark} width={compact ? 72 : 120} height={compact ? 28 : 44} />
    </div>
  );
}

export function MarketLink({ children, printing }: { children: ReactNode; printing?: string }) {
  return (
    <Link to="/tcg/market-prototype" search={{ tab: printing ? "printing" : undefined, printing }} className="underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

export function LangBadge({ lang }: { lang: string }) {
  return <Badge variant="outline">{lang.toUpperCase()}</Badge>;
}
