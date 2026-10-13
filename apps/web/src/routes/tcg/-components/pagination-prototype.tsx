// PROTOTYPE: four ways to paginate card browsing on /tcg, switched by `?variant=`.
// Throwaway. The page fetches up to TCG_ARTWORKS_MAX_LIMIT rows and these slice client-side;
// the winner needs server-side offset + total count before it ships.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { RouterOutputs } from "@/utils/trpc";

import { cardImage } from "./card-image";

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];
type Props = { artworks: ArtworkRow[]; renderCard: (a: ArtworkRow) => ReactNode };
type PagedProps = Props & { page: number; setPage: (page: number) => void };

export const PROTOTYPE_VARIANTS = [
  { key: "current", name: "Show more (today)" },
  { key: "A", name: "Numbered pages" },
  { key: "B", name: "Infinite scroll" },
  { key: "C", name: "Binder" },
  { key: "D", name: "Sections + jump rail" },
] as const;
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]["key"];

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
const fmt = (n: number) => n.toLocaleString();

/** 1 … p-1 p p+1 … n */
function pageWindow(page: number, pages: number) {
  return [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).toSorted((a, b) => a - b);
}

// ─── A: numbered pages ──────────────────────────────────────────────────────────

export function NumberedPages({ artworks, renderCard, page, setPage }: PagedProps) {
  const [size, setSize] = useState(50);
  const pages = Math.max(1, Math.ceil(artworks.length / size));
  const p = Math.min(page, pages);
  const from = (p - 1) * size;
  const top = useRef<HTMLDivElement>(null);
  const go = (n: number) => {
    setPage(n);
    top.current?.scrollIntoView({ block: "start" });
  };

  const bar = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        Showing {fmt(from + 1)}–{fmt(Math.min(from + size, artworks.length))} of {fmt(artworks.length)}
      </span>
      <nav aria-label="Pages" className="flex items-center gap-1">
        <Button size="xs" variant="outline" disabled={p === 1} onClick={() => go(p - 1)}>
          Prev
        </Button>
        {pageWindow(p, pages).map((n, i, all) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && n - all[i - 1]! > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Button size="xs" variant={n === p ? "default" : "ghost"} aria-current={n === p ? "page" : undefined} onClick={() => go(n)}>
              {n}
            </Button>
          </span>
        ))}
        <Button size="xs" variant="outline" disabled={p === pages} onClick={() => go(p + 1)}>
          Next
        </Button>
      </nav>
      <select
        aria-label="Per page"
        value={size}
        onChange={(e) => {
          setSize(Number(e.target.value));
          go(1);
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        {[25, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n} / page
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div ref={top} className="scroll-mt-4 space-y-4">
      {bar}
      <ul className={GRID}>{artworks.slice(from, from + size).map(renderCard)}</ul>
      {bar}
    </div>
  );
}

// ─── B: infinite scroll ────────────────────────────────────────────────────────

const CHUNK = 40;

export function InfiniteScroll({ artworks, renderCard }: Props) {
  const [shown, setShown] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const done = shown >= artworks.length;

  // Re-observe after each chunk so a sentinel still on screen keeps loading.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setShown((s) => s + CHUNK), {
      rootMargin: "800px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, done]);

  return (
    <div ref={top} className="scroll-mt-4 space-y-4">
      <ul className={GRID}>{artworks.slice(0, shown).map(renderCard)}</ul>
      <div ref={sentinel} className="py-6 text-center text-xs text-muted-foreground">
        {done ? `That's all ${fmt(artworks.length)}.` : "Loading more…"}
      </div>
      <div className="fixed right-20 bottom-4 z-40 flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1 text-xs shadow">
        <span>
          {fmt(Math.min(shown, artworks.length))} / {fmt(artworks.length)}
        </span>
        <Button size="xs" variant="ghost" onClick={() => top.current?.scrollIntoView({ behavior: "smooth" })}>
          ↑ Top
        </Button>
      </div>
    </div>
  );
}

// ─── C: binder — one 9-pocket page at a time, flip like a real binder ───────────

const POCKETS = 9;

export function Binder({ artworks, renderCard, page, setPage }: PagedProps) {
  const pages = Math.max(1, Math.ceil(artworks.length / POCKETS));
  const p = Math.min(page, pages);
  const sheet = artworks.slice((p - 1) * POCKETS, p * POCKETS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sheet.find((a) => a.variantId === selectedId) ?? sheet[0];

  const flip = (n: number) => setPage(Math.min(pages, Math.max(1, n)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "[" || e.key === "PageUp") flip(p - 1);
      if (e.key === "]" || e.key === "PageDown") flip(p + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-3 rounded-xl border border-border bg-muted p-4 shadow-inner">
          {Array.from({ length: POCKETS }, (_, i) => {
            const a = sheet[i];
            if (!a) return <div key={i} className="aspect-[63/88] rounded-sm border border-dashed border-border" />;
            const image = a.printings.find((pr) => pr.language === "ja") ?? a.printings[0];
            return (
              <button
                key={a.variantId}
                type="button"
                onClick={() => setSelectedId(a.variantId)}
                title={`${a.variantId} ${a.nameEn ?? a.nameJa ?? ""}`}
                className={`relative aspect-[63/88] overflow-hidden rounded-sm bg-background transition ${
                  selected?.variantId === a.variantId ? "ring-2 ring-primary" : "hover:scale-[1.02]"
                }`}
              >
                {image && <img src={cardImage(image.imageUrl)} alt="" className="size-full object-cover" />}
                {a.owned && (
                  <span className="absolute top-1 right-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">Owned</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mx-auto flex max-w-md items-center gap-3 text-xs">
          <Button size="sm" variant="outline" disabled={p === 1} onClick={() => flip(p - 1)}>
            ◀
          </Button>
          <input
            type="range"
            aria-label="Binder page"
            min={1}
            max={pages}
            value={p}
            onChange={(e) => flip(Number(e.target.value))}
            className="flex-1"
          />
          <Button size="sm" variant="outline" disabled={p === pages} onClick={() => flip(p + 1)}>
            ▶
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Page {fmt(p)} of {fmt(pages)} · {sheet[0]?.variantId} → {sheet.at(-1)?.variantId} · [ / ] to flip
        </p>
      </div>
      <aside className="md:sticky md:top-4 md:self-start">
        {selected ? <ul>{renderCard(selected)}</ul> : null}
      </aside>
    </div>
  );
}

// ─── D: sections grouped by set (or rating), sticky jump rail ──────────────────

const PREVIEW = 10;
const anchor = (key: string) => `group-${key.replace(/\W/g, "_")}`;

export function Sections({ artworks, renderCard, sort }: Props & { sort: "rating" | undefined }) {
  const groups = new Map<string, ArtworkRow[]>();
  for (const a of artworks) {
    const key = sort === "rating" ? (a.rating == null ? "Unrated" : `★ ${a.rating}`) : a.cardNumber.split("-")[0]!;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="grid gap-6 md:grid-cols-[120px_minmax(0,1fr)]">
      <nav aria-label="Jump to" className="flex gap-1 overflow-x-auto text-xs md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:flex-col md:self-start md:overflow-y-auto">
        {[...groups].map(([key, rows]) => (
          <a
            key={key}
            href={`#${anchor(key)}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(anchor(key))?.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex shrink-0 justify-between gap-2 rounded px-2 py-1 hover:bg-muted"
          >
            <span className="font-medium">{key}</span>
            <span className="text-muted-foreground">{rows.length}</span>
          </a>
        ))}
      </nav>
      <div className="space-y-8">
        {[...groups].map(([key, rows]) => {
          const open = expanded.has(key);
          return (
            <section key={key} id={anchor(key)} className="scroll-mt-4 space-y-3">
              <h2 className="sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 py-1 text-lg font-semibold">
                {key} <span className="text-xs font-normal text-muted-foreground">{fmt(rows.length)} Artworks</span>
              </h2>
              <ul className={GRID}>{(open ? rows : rows.slice(0, PREVIEW)).map(renderCard)}</ul>
              {rows.length > PREVIEW && (
                <Button size="xs" variant="outline" onClick={() => toggle(key)}>
                  {open ? `Collapse ${key}` : `Show all ${fmt(rows.length)} in ${key}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
