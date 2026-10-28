import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TCG_CONDITIONS, TCG_LANGUAGE_NAME } from "@life-tracker/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc, type RouterOutputs } from "@/utils/trpc";

type Want = RouterOutputs["tcg"]["wants"]["list"][number];
type Language = Want["languages"][number];
type Condition = Want["minCondition"];

const LANGUAGES = Object.entries(TCG_LANGUAGE_NAME) as Array<[Language, string]>;

/** Create a Want for an Artwork, or edit an existing Want's terms. */
export function WantDialog({
  variantId,
  label,
  want,
  onClose,
}: {
  variantId: string;
  /** Card name shown in the title. */
  label: string;
  want?: Pick<Want, "id" | "languages" | "maxPrice" | "minCondition">;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [languages, setLanguages] = useState<Language[]>(want?.languages ?? ["ja", "en"]);
  const [maxPrice, setMaxPrice] = useState(want ? String(want.maxPrice) : "");
  const [minCondition, setMinCondition] = useState<Condition>(want?.minCondition ?? "LP");

  const options = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trpc.tcg.wants.pathKey() });
      queryClient.invalidateQueries({ queryKey: trpc.tcg.artworks.pathKey() });
      onClose();
    },
  };
  const create = useMutation(trpc.tcg.wants.create.mutationOptions(options));
  const update = useMutation(trpc.tcg.wants.update.mutationOptions(options));
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const price = Number(maxPrice);
  const valid = languages.length > 0 && maxPrice !== "" && price > 0;
  const save = () => {
    const terms = { languages, maxPrice: price, minCondition };
    if (want) update.mutate({ id: want.id, ...terms });
    else create.mutate({ variantId, ...terms });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{want ? "Edit Want" : "Want"}: {label}</DialogTitle>
          <DialogDescription>{variantId}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save();
          }}
        >
          <fieldset className="space-y-1 text-sm">
            <legend className="text-xs text-muted-foreground">Accepted languages</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {LANGUAGES.map(([lang, name]) => (
                <label key={lang} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={languages.includes(lang)}
                    onChange={(e) =>
                      setLanguages((prev) => (e.target.checked ? [...prev, lang] : prev.filter((l) => l !== lang)))
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Max delivered price (USD)</span>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-32"
              required
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Minimum Condition</span>
            <select
              value={minCondition}
              onChange={(e) => setMinCondition(e.target.value as Condition)}
              className="block rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {TCG_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-destructive">{error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? "Saving…" : want ? "Save" : "Add Want"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
