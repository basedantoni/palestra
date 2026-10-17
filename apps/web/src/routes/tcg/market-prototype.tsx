/** PROTOTYPE (KOI-325), throwaway: variant B's Market hub. See -components/market-watch-prototype.tsx. */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { cardImage } from "./-components/card-image";
import {
  Change,
  CollectionValueChart,
  CollectionValueTile,
  ConditionGrid,
  LangBadge,
  PriceHistoryChart,
  PrototypeSwitcher,
  Sparkline,
  quote,
  usd,
  useHoldings,
  useMovers,
  type Lang,
  type Mover,
} from "./-components/market-watch-prototype";

const searchSchema = z.object({
  tab: z.enum(["collection", "movers", "printing"]).optional().catch(undefined),
  /** `variantId:lang` */
  printing: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/tcg/market-prototype")({
  validateSearch: (s) => searchSchema.parse(s),
  component: MarketHub,
});

function MarketHub() {
  const { tab = "collection", printing } = Route.useSearch();
  const navigate = Route.useNavigate();
  const go = (next: z.infer<typeof searchSchema>) => navigate({ search: next, replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Market</h1>
        <div className="flex gap-4 text-sm">
          <Link to="/tcg" className="underline underline-offset-4">
            Cards
          </Link>
          <Link to="/tcg/binder" className="underline underline-offset-4">
            Binder
          </Link>
          <Link to="/tcg/wants" className="underline underline-offset-4">
            Wants
          </Link>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(t) => go({ tab: t as typeof tab, printing })}>
        <TabsList>
          <TabsTrigger value="collection">My collection</TabsTrigger>
          <TabsTrigger value="movers">Movers</TabsTrigger>
          <TabsTrigger value="printing">Printing lookup</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "collection" && <CollectionTab onPick={(p) => go({ tab: "printing", printing: p })} />}
      {tab === "movers" && <MoversTab onPick={(p) => go({ tab: "printing", printing: p })} />}
      {tab === "printing" && <PrintingTab printing={printing} onPick={(p) => go({ tab: "printing", printing: p })} />}
      <PrototypeSwitcher />
    </div>
  );
}

function CollectionTab({ onPick }: { onPick: (p: string) => void }) {
  const { copies } = useHoldings();
  const rows = copies
    .map((c) => ({ c, q: quote(c.variantId, c.language as Lang, c.condition) }))
    .sort((a, b) => b.q.usd - a.q.usd);
  return (
    <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-3">
        <CollectionValueTile />
        <p className="text-xs text-muted-foreground">
          Each Copy at its own Condition's Market Price on its language's first Marketplace, counted from the day it was
          acquired. Dashed line: what you paid.
        </p>
      </div>
      <div className="space-y-4">
        <CollectionValueChart height={240} />
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Copy</th>
              <th className="text-right font-normal">Paid</th>
              <th className="text-right font-normal">Market</th>
              <th className="text-right font-normal">Gain</th>
              <th className="text-right font-normal">7d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, q }) => (
              <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-muted" onClick={() => onPick(`${c.variantId}:${c.language}`)}>
                <td className="py-1">
                  {c.nameEn ?? c.nameJa} <span className="text-xs text-muted-foreground">{c.variantId}</span>{" "}
                  <LangBadge lang={c.language} /> <span className="text-xs">{c.condition}</span>
                </td>
                <td className="text-right">{c.pricePaid == null ? "—" : usd(c.pricePaid)}</td>
                <td className="text-right font-medium">{usd(q.usd)}</td>
                <td className="text-right">
                  {c.pricePaid == null ? "—" : <Change value={q.usd / c.pricePaid - 1} />}
                </td>
                <td className="text-right">
                  <Change value={q.change7} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MoversTab({ onPick }: { onPick: (p: string) => void }) {
  const { gainers, losers } = useMovers();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <MoverTable title="Biggest gainers, 7 days" rows={gainers} onPick={onPick} />
      <MoverTable title="Biggest drops, 7 days" rows={losers} onPick={onPick} />
      <p className="text-xs text-muted-foreground md:col-span-2">
        Printings over $2, NM, each language's first Marketplace. Prototype ranks the first 600 Artworks only.
      </p>
    </div>
  );
}

function MoverTable({ title, rows, onPick }: { title: string; rows: Mover[]; onPick: (p: string) => void }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="divide-y divide-border border border-border">
        {rows.map((m) => (
          <li key={`${m.variantId}:${m.lang}`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => onPick(`${m.variantId}:${m.lang}`)}
            >
              <img src={cardImage(m.imageUrl)} alt="" loading="lazy" className="aspect-[63/88] w-8 rounded-sm bg-muted object-cover" />
              <span className="min-w-0 flex-1 truncate">
                {m.name} <span className="text-xs text-muted-foreground">{m.variantId}</span> <LangBadge lang={m.lang} />
              </span>
              <Sparkline data={m.spark} />
              <span className="w-16 text-right tabular-nums">{usd(m.quote.usd)}</span>
              <Change value={m.quote.change7} className="w-16 text-right text-xs" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrintingTab({ printing, onPick }: { printing?: string; onPick: (p: string) => void }) {
  const [text, setText] = useState("");
  const [variantId, lang] = (printing ?? "OP01-120_p1:ja").split(":") as [string, Lang];
  const q = quote(variantId, lang);
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const [v, l = "ja"] = text.trim().split(/\s+/);
          if (v) onPick(`${v.toUpperCase().replace("_P", "_p")}:${l.toLowerCase()}`);
        }}
      >
        <Input placeholder="Variant id and language, e.g. OP05-119_p1 en" value={text} onChange={(e) => setText(e.target.value)} className="w-96" />
      </form>
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl font-semibold">{variantId}</h2>
        <LangBadge lang={lang} />
        <span className="text-2xl font-semibold tabular-nums">{usd(q.usd)}</span>
        <span className="text-xs text-muted-foreground">
          NM on {q.marketplace} · <Change value={q.change7} /> 7d · <Change value={q.change30} /> 30d
        </span>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <PriceHistoryChart key={printing} variantId={variantId} lang={lang} height={320} />
        <ConditionGrid variantId={variantId} lang={lang} />
      </div>
    </div>
  );
}
