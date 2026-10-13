import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { ThemesDialog } from "./-components/art-taste";
import { useArtworkCards } from "./-components/artwork-card";
import { ArtworkSections } from "./-components/artwork-sections";

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

  const update = (next: Partial<z.infer<typeof tcgSearchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const { renderCard, dialogs } = useArtworkCards((artist) => update({ artist }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cards</h1>
        <div className="flex gap-4">
          <Link to="/tcg/binder" className="text-sm underline underline-offset-4">
            Binder
          </Link>
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

      <ArtworkSections filters={filters} renderCard={renderCard} />
      {dialogs}
    </div>
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
