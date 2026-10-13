import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TCG_ARTWORKS_MAX_LIMIT } from "@life-tracker/shared";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { trpc, type RouterInputs, type RouterOutputs } from "@/utils/trpc";

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];
type Filters = RouterInputs["tcg"]["artworkSections"];
type Sort = RouterInputs["tcg"]["artworks"]["sort"];

/** Artworks a collapsed section shows. */
const PREVIEW = 10;
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
const anchor = (key: string) => `section-${key}`;

/** Browse split into sections with a jump rail; each section fetches its Artworks once it nears the screen. */
export function ArtworkSections({
  filters,
  sort,
  renderCard,
}: {
  filters: Filters;
  sort: Sort;
  renderCard: (a: ArtworkRow) => ReactNode;
}) {
  const { data: sections, isLoading } = useQuery({
    ...trpc.tcg.artworkSections.queryOptions(filters),
    placeholderData: keepPreviousData,
  });
  // New filters remount every section: collapsed, and fetched afresh.
  const filtersKey = JSON.stringify(filters);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!sections?.length) {
    return (
      <p className="text-sm text-muted-foreground">No Artworks match. Run `pnpm db:import:tcg` if the catalog is empty.</p>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[120px_minmax(0,1fr)]">
      <nav
        aria-label="Jump to section"
        className="flex gap-1 overflow-x-auto text-xs md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:flex-col md:self-start md:overflow-y-auto"
      >
        {sections.map((s) => (
          <a
            key={s.key}
            href={`#${anchor(s.key)}`}
            onClick={(e) => {
              e.preventDefault();
              // Instant, so sections passed on the way don't load and shift the target.
              document.getElementById(anchor(s.key))?.scrollIntoView();
            }}
            className="flex shrink-0 justify-between gap-2 rounded px-2 py-1 hover:bg-muted"
          >
            <span className="font-medium">{s.key}</span>
            <span className="text-muted-foreground">{s.count.toLocaleString()}</span>
          </a>
        ))}
      </nav>
      <div className="space-y-8">
        {sections.map((s) => (
          <Section
            key={`${filtersKey}|${s.key}`}
            sectionKey={s.key}
            count={s.count}
            filters={filters}
            sort={sort}
            renderCard={renderCard}
          />
        ))}
      </div>
    </div>
  );
}

function Section({
  sectionKey,
  count,
  filters,
  sort,
  renderCard,
}: {
  sectionKey: string;
  count: number;
  filters: Filters;
  sort: Sort;
  renderCard: (a: ArtworkRow) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const seen = useSeen(ref);
  const [open, setOpen] = useState(false);
  const { data: artworks } = useQuery({
    ...trpc.tcg.artworks.queryOptions({
      ...filters,
      sort,
      section: sectionKey,
      limit: open ? TCG_ARTWORKS_MAX_LIMIT : PREVIEW,
    }),
    enabled: seen,
    placeholderData: keepPreviousData,
  });

  return (
    <section ref={ref} id={anchor(sectionKey)} className="scroll-mt-4 space-y-3">
      <h2 className="sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 py-1 text-lg font-semibold">
        {sectionKey}
        <span className="text-xs font-normal text-muted-foreground">
          {count.toLocaleString()} {count === 1 ? "Artwork" : "Artworks"}
        </span>
      </h2>
      <ul className={GRID}>
        {artworks
          ? artworks.map(renderCard)
          : // Placeholders hold roughly the loaded height, so jumping to a section lands on it.
            Array.from({ length: Math.min(count, PREVIEW) }, (_, i) => (
              <li key={i} className="space-y-2">
                <div className="aspect-[63/88] w-full rounded-sm bg-muted" />
                <div className="h-24" />
              </li>
            ))}
      </ul>
      {count > PREVIEW && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setOpen(!open);
            // Collapsing a long section would leave the reader far below it.
            if (open && ref.current && ref.current.getBoundingClientRect().top < 0) ref.current.scrollIntoView();
          }}
        >
          {open ? `Collapse ${sectionKey}` : `Show all ${count.toLocaleString()} in ${sectionKey}`}
        </Button>
      )}
    </section>
  );
}

/** True once the element has come within a screen of the viewport. */
function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}
