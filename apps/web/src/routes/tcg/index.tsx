import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/utils/trpc";

import { cardImage } from "./-components/card-image";
import { CopyDialog } from "./-components/copy-dialog";
import { WantDialog } from "./-components/want-dialog";
import { ArtRatingSelect, ThemeTagMenu, ThemesDialog } from "./-components/art-taste";
import { ArtworkSections } from "./-components/artwork-sections";
import { invalidateBrowse } from "./-components/invalidate-browse";

const VARIANT_KINDS = ["base", "parallel", "manga", "reprint"] as const;
const TYPING_DEBOUNCE_MS = 300;
const LANGUAGES = Object.keys(TCG_LANGUAGE_NAME) as Array<keyof typeof TCG_LANGUAGE_NAME>;

// Filters live in the URL so a filtered view survives reloads.
const tcgSearchSchema = z.object({
  character: z.string().optional().catch(undefined),
  set: z.string().optional().catch(undefined),
  kind: z.enum(VARIANT_KINDS).optional().catch(undefined),
  artist: z.string().optional().catch(undefined),
  conflict: z.boolean().optional().catch(undefined),
  minRating: z.number().int().min(0).max(5).optional().catch(undefined),
  theme: z.string().uuid().optional().catch(undefined),
  sort: z.enum(["rating"]).optional().catch(undefined),
  /** Only Artworks the user owns a Copy of: the collection view. */
  owned: z.boolean().optional().catch(undefined),
  /** Only Artworks printed in this language; with `owned`, owned in this language. */
  lang: z.enum(LANGUAGES).optional().catch(undefined),
});

type ArtworkRow = RouterOutputs["tcg"]["artworks"][number];

export const Route = createFileRoute("/tcg/")({
  validateSearch: (search) => tcgSearchSchema.parse(search),
  component: TcgPage,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

function TcgPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [wanting, setWanting] = useState<{ variantId: string; label: string } | null>(null);
  const { data: sets } = useQuery(trpc.tcg.sets.queryOptions());
  const { data: themes } = useQuery(trpc.tcg.themes.queryOptions());
  const filters = {
    character: search.character,
    set: search.set,
    variantKind: search.kind,
    artist: search.artist,
    conflict: search.conflict,
    owned: search.owned,
    language: search.lang,
    minRating: search.minRating,
    themeId: search.theme,
    sort: search.sort,
  };

  const [adding, setAdding] = useState<ArtworkRow | null>(null);
  const today = useFinanceToday();
  const queryClient = useQueryClient();
  const addCopy = useMutation(
    trpc.tcg.copies.create.mutationOptions({
      onSuccess: () => {
        setAdding(null);
        invalidateBrowse(queryClient);
        queryClient.invalidateQueries({ queryKey: trpc.tcg.copies.list.pathKey() });
      },
    }),
  );

  const update = (next: Partial<z.infer<typeof tcgSearchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cards</h1>
        <div className="flex gap-4">
          <Link to="/tcg/copies" className="text-sm underline underline-offset-4">
            My Copies
          </Link>
          <Link to="/tcg/wants" className="text-sm underline underline-offset-4">
            Wants
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput label="Character" value={search.character} onChange={(character) => update({ character })} />
        <SearchInput label="Artist" value={search.artist} onChange={(artist) => update({ artist })} />
        <select
          aria-label="Set"
          value={search.set ?? ""}
          onChange={(e) => update({ set: e.target.value || undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All sets</option>
          {(sets ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Variant kind"
          value={search.kind ?? ""}
          onChange={(e) => update({ kind: (e.target.value || undefined) as (typeof VARIANT_KINDS)[number] | undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All kinds</option>
          {VARIANT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={search.conflict ?? false}
            onChange={(e) => update({ conflict: e.target.checked || undefined })}
          />
          Artist conflicts only
        </label>
        <select
          aria-label="Minimum Art Rating"
          value={search.minRating ?? ""}
          onChange={(e) => update({ minRating: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Any rating</option>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              ★ {n}+
            </option>
          ))}
        </select>
        <select
          aria-label="Theme"
          value={search.theme ?? ""}
          onChange={(e) => update({ theme: e.target.value || undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All Themes</option>
          {(themes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort"
          value={search.sort ?? ""}
          onChange={(e) => update({ sort: e.target.value === "rating" ? "rating" : undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Sort: card number</option>
          <option value="rating">Sort: Art Rating</option>
        </select>
        <select
          aria-label="Language"
          value={search.lang ?? ""}
          onChange={(e) => update({ lang: (e.target.value || undefined) as (typeof LANGUAGES)[number] | undefined })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Any language</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {TCG_LANGUAGE_NAME[l]}
            </option>
          ))}
        </select>
        <ThemesDialog />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={search.owned ?? false}
            onChange={(e) => update({ owned: e.target.checked || undefined })}
          />
          Owned
        </label>
      </div>

      <ArtworkSections
        filters={filters}
        renderCard={(a) => (
          <ArtworkCard
            key={a.variantId}
            artwork={a}
            onArtist={(artist) => update({ artist })}
            onAdd={() => setAdding(a)}
            onWant={() => setWanting({ variantId: a.variantId, label: a.nameEn ?? a.nameJa ?? a.cardNumber })}
          />
        )}
      />

      {adding && (
        <CopyDialog
          title={`Add a Copy of ${adding.variantId}`}
          initial={{ printingId: adding.printings[0]!.id, condition: "NM", pricePaid: null, acquiredOn: today }}
          printings={adding.printings}
          pending={addCopy.isPending}
          error={addCopy.error?.message}
          onSubmit={(values) => addCopy.mutate(values)}
          onClose={() => {
            addCopy.reset();
            setAdding(null);
          }}
        />
      )}
      {wanting && <WantDialog {...wanting} onClose={() => setWanting(null)} />}
    </div>
  );
}

/** One Artwork in browse: image, credits, Printings, and the buy and taste actions. */
function ArtworkCard({
  artwork: a,
  onArtist,
  onAdd,
  onWant,
}: {
  artwork: ArtworkRow;
  onArtist: (artist: string) => void;
  onAdd: () => void;
  onWant: () => void;
}) {
  const image = a.printings.find((p) => p.language === "ja") ?? a.printings[0];
  return (
    <li className="space-y-1">
      {image && (
        <img
          src={cardImage(image.imageUrl)}
          alt={`${a.variantId} ${a.nameEn ?? a.nameJa ?? ""}`}
          loading="lazy"
          className="aspect-[63/88] w-full rounded-sm bg-muted object-cover"
        />
      )}
      <div className="text-xs font-medium">{a.nameEn ?? a.nameJa}</div>
      <div className="flex items-center gap-1 text-xs">
        {a.artist ? (
          <button
            type="button"
            className="truncate text-left underline-offset-2 hover:underline"
            title={`Show Artworks by ${a.artist}`}
            onClick={() => onArtist(a.artist!)}
          >
            {a.artist}
          </button>
        ) : (
          <span className="text-muted-foreground italic">uncredited</span>
        )}
        {a.artistConflict && (
          <Badge variant="destructive" title="Japanese and English sources credit different artists">
            conflict
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>{a.variantId}</span>
        <Badge variant="secondary">{a.variantKind}</Badge>
        {a.printings.map((p) => (
          <Badge key={p.language} variant="outline" title={p.setName}>
            {p.language.toUpperCase()}
          </Badge>
        ))}
        {a.owned && <Badge>Owned</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {a.wanted && <Badge>Wanted</Badge>}
        <Button size="xs" variant="outline" onClick={onAdd}>
          Add Copy
        </Button>
        <Button size="xs" variant="outline" onClick={onWant}>
          {a.wanted ? "Want another" : "Want"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <ArtRatingSelect variantId={a.variantId} rating={a.rating} />
        <ThemeTagMenu variantId={a.variantId} tagged={a.themes} />
        {a.themes.map((t) => (
          <Badge key={t.id} variant="secondary">
            {t.name}
          </Badge>
        ))}
      </div>
    </li>
  );
}

/** A text filter that updates the URL once typing pauses, not on every keystroke. */
function SearchInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const pushed = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The URL changed elsewhere (e.g. clicking an artist): show it.
  useEffect(() => {
    if (value === pushed.current) return;
    pushed.current = value;
    setText(value ?? "");
  }, [value]);

  useEffect(() => {
    const next = text || undefined;
    if (next === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = next;
      onChangeRef.current(next);
    }, TYPING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <Input aria-label={label} placeholder={label} value={text} onChange={(e) => setText(e.target.value)} className="w-48" />
  );
}
