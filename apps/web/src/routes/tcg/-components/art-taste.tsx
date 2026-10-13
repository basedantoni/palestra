import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TagIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { trpc } from "@/utils/trpc";

import { invalidateBrowse } from "./invalidate-browse";

/** Art Rating and Theme controls for the browse page (KOI-307). */

const selectClass = "rounded-md border border-border bg-background px-1 py-0.5 text-xs";

/** Ratings and tags show on browse rows; Theme edits also change the Theme list. */
function useInvalidate() {
  const queryClient = useQueryClient();
  const artworks = () => invalidateBrowse(queryClient);
  const themes = () =>
    Promise.all([artworks(), queryClient.invalidateQueries({ queryKey: trpc.tcg.themes.pathKey() })]);
  return { artworks, themes };
}

export function ArtRatingSelect({ variantId, rating }: { variantId: string; rating: number | null }) {
  const { artworks } = useInvalidate();
  const setRating = useMutation(trpc.tcg.setRating.mutationOptions({ onSuccess: artworks }));
  return (
    <select
      aria-label={`Art Rating for ${variantId}`}
      value={rating ?? ""}
      disabled={setRating.isPending}
      onChange={(e) => setRating.mutate({ variantId, rating: e.target.value === "" ? null : Number(e.target.value) })}
      className={selectClass}
    >
      <option value="">☆ –</option>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>
          ★ {n}
        </option>
      ))}
    </select>
  );
}

export function ThemeTagMenu({ variantId, tagged }: { variantId: string; tagged: Array<{ id: string }> }) {
  const { artworks } = useInvalidate();
  const { data: themes } = useQuery(trpc.tcg.themes.queryOptions());
  const tag = useMutation(trpc.tcg.tagArtwork.mutationOptions({ onSuccess: artworks }));
  const untag = useMutation(trpc.tcg.untagArtwork.mutationOptions({ onSuccess: artworks }));
  const taggedIds = new Set(tagged.map((t) => t.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Themes for ${variantId}`} />}>
        <TagIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {!themes?.length && <p className="px-2 py-2 text-xs text-muted-foreground">No Themes yet.</p>}
        {themes?.map((t) => (
          <DropdownMenuCheckboxItem
            key={t.id}
            checked={taggedIds.has(t.id)}
            onCheckedChange={(checked) => (checked ? tag : untag).mutate({ themeId: t.id, variantId })}
          >
            {t.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemesDialog() {
  const { themes: invalidate } = useInvalidate();
  const { data: themes } = useQuery(trpc.tcg.themes.queryOptions());
  const [name, setName] = useState("");
  const create = useMutation(
    trpc.tcg.createTheme.mutationOptions({
      onSuccess: () => {
        setName("");
        invalidate();
      },
    }),
  );
  const rename = useMutation(trpc.tcg.renameTheme.mutationOptions({ onSettled: invalidate }));
  const remove = useMutation(trpc.tcg.deleteTheme.mutationOptions({ onSuccess: invalidate }));
  const error = create.error ?? rename.error ?? remove.error;

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Themes</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Themes</DialogTitle>
          <DialogDescription>Your own tags for Artworks. Deleting a Theme removes its tags.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name });
          }}
        >
          <Input aria-label="New Theme name" placeholder="New Theme" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={create.isPending}>
            Add
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error.message}</p>}
        <ul className="divide-y divide-border border border-border">
          {themes?.map((t) => (
            <li key={`${t.id}:${t.name}`} className="flex items-center gap-2 p-2">
              <Input
                aria-label={`Rename ${t.name}`}
                defaultValue={t.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== t.name) rename.mutate({ id: t.id, name: next });
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.confirm(`Delete “${t.name}” and its tags?`) && remove.mutate({ id: t.id })}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
