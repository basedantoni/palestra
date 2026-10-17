/**
 * PROTOTYPE (KOI-325), throwaway: what each existing TCG page shows per variant. Host pages mount these
 * with one line each; the switch lives in market-watch-prototype.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { cardImage } from "./card-image";
import {
  Change,
  CollectionValueChart,
  CollectionValueTile,
  MarketLink,
  PriceHistoryChart,
  PriceLine,
  PrintingDrawer,
  PrototypeSwitcher,
  RangeBar,
  Sparkline,
  VsMarket,
  openPrintingDrawer,
  priceHistory,
  quote,
  useCollectionValue,
  useMarketVariant,
  useMovers,
  usd,
  type Condition,
  type Lang,
} from "./market-watch-prototype";

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];
type Want = RouterOutputs["tcg"]["wants"]["list"][number];
type Offer = Want["offers"][number];
type CopyRow = RouterOutputs["tcg"]["copies"]["list"][number];

const primaryLang = (langs: string[]) => (langs.includes("ja") ? "ja" : langs[0]) as Lang;

/** Every page: the switcher, and variant C's drawer. */
export function MarketChrome() {
  const v = useMarketVariant();
  return (
    <>
      {v === "C" && <PrintingDrawer />}
      <PrototypeSwitcher />
    </>
  );
}

/** A header link to the Market hub (variant B only). */
export function MarketNavLink() {
  const v = useMarketVariant();
  if (v !== "B") return null;
  return (
    <span className="text-sm font-medium">
      <MarketLink>Market →</MarketLink>
    </span>
  );
}

// ---------------------------------------------------------------- Artwork card

/** Over the card image: variant C's price tag. */
export function MarketOnCardImage({ artwork: a }: { artwork: ArtworkRow }) {
  const v = useMarketVariant();
  if (v !== "C") return null;
  const lang = primaryLang(a.printings.map((p) => p.language));
  const q = quote(a.variantId, lang);
  return (
    <button
      type="button"
      onClick={() =>
        openPrintingDrawer({
          variantId: a.variantId,
          lang,
          name: a.nameEn ?? a.nameJa ?? a.cardNumber,
          imageUrl: a.printings.find((p) => p.language === lang)?.imageUrl,
          langs: a.printings.map((p) => p.language as Lang),
        })
      }
      className="absolute top-1 right-1 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow"
      title="Price History"
    >
      {usd(q.usd)} <Change value={q.change7} className="text-[9px]" />
    </button>
  );
}

/** Under the credits: A's per-language prices + History dialog, B's one price linking to the hub. */
export function MarketOnCard({ artwork: a }: { artwork: ArtworkRow }) {
  const v = useMarketVariant();
  const [open, setOpen] = useState(false);
  const langs = a.printings.map((p) => p.language as Lang);
  if (v === "A") {
    return (
      <div className="space-y-0.5 text-xs">
        {langs.map((l) => (
          <PriceLine key={l} variantId={a.variantId} lang={l} spark />
        ))}
        <button type="button" className="text-[11px] underline underline-offset-2" onClick={() => setOpen(true)}>
          Price History
        </button>
        {open && <HistoryDialog artwork={a} onClose={() => setOpen(false)} />}
      </div>
    );
  }
  if (v === "B") {
    const lang = primaryLang(langs);
    const q = quote(a.variantId, lang);
    return (
      <div className="text-xs tabular-nums">
        <MarketLink printing={`${a.variantId}:${lang}`}>
          {lang.toUpperCase()} {usd(q.usd)}
        </MarketLink>
      </div>
    );
  }
  return null;
}

function HistoryDialog({ artwork: a, onClose }: { artwork: ArtworkRow; onClose: () => void }) {
  const langs = a.printings.map((p) => p.language as Lang);
  const [lang, setLang] = useState(primaryLang(langs));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {a.nameEn ?? a.nameJa} · {a.variantId}
          </DialogTitle>
        </DialogHeader>
        <Tabs value={lang} onValueChange={(l) => setLang(l as Lang)}>
          <TabsList>
            {langs.map((l) => (
              <TabsTrigger key={l} value={l}>
                {l.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <PriceHistoryChart key={lang} variantId={a.variantId} lang={lang} />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Cards page

/** Above browse: variant C's market pulse (collection value + movers strip). */
export function MarketPulse() {
  const v = useMarketVariant();
  const { gainers, losers } = useMovers();
  if (v !== "C") return null;
  return (
    <div className="flex gap-3 overflow-hidden [contain:inline-size]">
      <CollectionValueTile />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Moving this week</div>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {[...gainers.slice(0, 6), ...losers.slice(0, 4)].map((m) => (
            <li key={`${m.variantId}:${m.lang}`} className="w-20 shrink-0">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => openPrintingDrawer({ variantId: m.variantId, lang: m.lang, name: m.name, imageUrl: m.imageUrl })}
              >
                <img src={cardImage(m.imageUrl)} alt="" loading="lazy" className="aspect-[63/88] w-full rounded-sm bg-muted object-cover" />
                <div className="truncate text-[11px]">{m.name}</div>
                <div className="flex justify-between text-[11px] tabular-nums">
                  {usd(m.quote.usd)} <Change value={m.quote.change7} className="text-[10px]" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Variant A: "Sort: 7d move" replaces browse sections with one grid ranked by this week's move. */
export function MoversGrid({ renderCard }: { renderCard: (a: ArtworkRow) => ReactNode }) {
  const { data } = useQuery(trpc.tcg.artworks.queryOptions({ limit: 600 }));
  const ranked = (data ?? [])
    .map((a) => ({ a, move: Math.max(...a.printings.map((p) => Math.abs(quote(a.variantId, p.language as Lang).change7))) }))
    .sort((x, y) => y.move - x.move)
    .slice(0, 40);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Largest 7-day moves, either direction (prototype ranks the first 600 Artworks).</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">{ranked.map(({ a }) => renderCard(a))}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- Wants

export function MarketOnWant({ want: w }: { want: Want }) {
  const v = useMarketVariant();
  const lang = primaryLang(w.languages);
  if (v === "A") {
    return (
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {w.languages.map((l) => {
          const q = quote(w.variantId, l as Lang);
          return (
            <span key={l} className="tabular-nums">
              Market {l.toUpperCase()} <span className="font-medium text-foreground">{usd(q.usd)}</span> NM ({q.marketplace}) · 30d{" "}
              {usd(q.low30)}–{usd(q.high30)}
            </span>
          );
        })}
      </div>
    );
  }
  if (v === "B") {
    return (
      <div className="text-xs">
        <MarketLink printing={`${w.variantId}:${lang}`}>See market →</MarketLink>
      </div>
    );
  }
  return null;
}

/** Variant C: the Want's image opens the drawer. */
export function WantImageButton({ want: w, children }: { want: Want; children: ReactNode }) {
  const v = useMarketVariant();
  if (v !== "C") return <>{children}</>;
  return (
    <button
      type="button"
      title="Price History"
      onClick={() =>
        openPrintingDrawer({
          variantId: w.variantId,
          lang: primaryLang(w.languages),
          name: w.nameEn ?? w.nameJa ?? w.variantId,
          imageUrl: w.imageUrl ?? undefined,
          langs: w.languages as Lang[],
        })
      }
    >
      {children}
    </button>
  );
}

export function MarketOnOffer({ want: w, offer: o }: { want: Want; offer: Offer }) {
  const v = useMarketVariant();
  const q = quote(w.variantId, o.language as Lang);
  if (v === "C") {
    return (
      <span className="flex items-center gap-2 text-[11px]">
        <RangeBar price={o.price} q={q} />
        <VsMarket price={o.price} market={q.usd} />
      </span>
    );
  }
  return (
    <span className="text-[11px]">
      <VsMarket price={o.price} market={q.usd} />
    </span>
  );
}

// ---------------------------------------------------------------- Binder

export function MarketBinderHeader() {
  const v = useMarketVariant();
  const value = useCollectionValue();
  if (v === "A") return <CollectionValueTile compact />;
  if (v === "B") {
    return (
      <MarketLink>
        <span className="text-sm tabular-nums">
          Worth {usd(value.value)} <Change value={value.change30} /> · Market →
        </span>
      </MarketLink>
    );
  }
  return null;
}

/** Variant C: a price sticker on each pocket. */
export function PocketSticker({ variantId, langs, name, imageUrl }: { variantId: string; langs: string[]; name: string; imageUrl?: string }) {
  const v = useMarketVariant();
  if (v !== "C") return null;
  const lang = primaryLang(langs);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        openPrintingDrawer({ variantId, lang, name, imageUrl, langs: langs as Lang[] });
      }}
      className="absolute right-0.5 bottom-0.5 rounded-sm bg-amber-100 px-1 text-[10px] font-semibold text-amber-950 tabular-nums shadow"
    >
      {usd(quote(variantId, lang).usd)}
    </span>
  );
}

export function MarketBinderSheetTotal({ variantIds, totalOwned }: { variantIds: Array<{ variantId: string; langs: string[] }>; totalOwned: number }) {
  const v = useMarketVariant();
  const value = useCollectionValue();
  if (v !== "C") return null;
  const sheet = variantIds.reduce((s, a) => s + quote(a.variantId, primaryLang(a.langs)).usd, 0);
  return (
    <p className="text-center text-xs tabular-nums">
      This sheet {usd(sheet)} · whole binder {usd(value.value)} ({totalOwned} Artworks) <Change value={value.change30} /> 30d
    </p>
  );
}

/** Binder aside under the selected card: A shows its prices and a small chart. */
export function MarketBinderAside({ artwork: a }: { artwork: ArtworkRow }) {
  const v = useMarketVariant();
  if (v !== "A") return null;
  const lang = primaryLang(a.printings.map((p) => p.language));
  return (
    <div className="mt-3 space-y-1 border-t border-border pt-2">
      <PriceHistoryChart key={a.variantId} variantId={a.variantId} lang={lang} height={140} />
    </div>
  );
}

// ---------------------------------------------------------------- Copies

export function MarketCopiesHeader() {
  const v = useMarketVariant();
  const value = useCollectionValue();
  if (v === "A") {
    return (
      <div className="space-y-2">
        <CollectionValueTile />
        <CollectionValueChart height={160} />
      </div>
    );
  }
  if (v === "B") {
    return (
      <p className="text-sm">
        Worth {usd(value.value)} today. <MarketLink>Value over time in Market →</MarketLink>
      </p>
    );
  }
  return <CollectionValueTile compact />;
}

export function MarketOnCopy({ copy: c }: { copy: CopyRow }) {
  const v = useMarketVariant();
  if (v === "B") return null;
  const q = quote(c.variantId, c.language as Lang, c.condition as Condition);
  const gain = c.pricePaid == null ? null : q.usd - c.pricePaid;
  const body = (
    <span className="flex items-center gap-2 text-xs tabular-nums">
      <span className="font-medium">{usd(q.usd)}</span>
      {gain !== null && (
        <span className={gain >= 0 ? "text-emerald-600" : "text-red-600"}>
          {gain >= 0 ? "+" : "−"}
          {usd(Math.abs(gain))}
        </span>
      )}
      {v === "A" && <Sparkline data={priceHistory(c.variantId, c.language as Lang, q.marketplace, c.condition as Condition).slice(-30).map((p) => p.usd)} />}
    </span>
  );
  if (v === "C") {
    return (
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          openPrintingDrawer({ variantId: c.variantId, lang: c.language as Lang, name: c.nameEn ?? c.nameJa ?? c.variantId, imageUrl: c.imageUrl })
        }
      >
        {body}
      </Button>
    );
  }
  return body;
}
