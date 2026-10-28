import { TCG_LANGUAGE_NAME } from "@life-tracker/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LANGUAGES = ["zh", "ko"] as const;
type Language = (typeof LANGUAGES)[number];

/**
 * Delete a phantom Simplified Chinese or Korean Printing that CardTrader Listings created
 * (KOI-372), by its Artwork's variant ID. The server refuses one with a Copy or an Offer.
 */
export function DeletePrinting({
  onDelete,
  pending = false,
}: {
  onDelete: (variantId: string, language: Language) => void;
  pending?: boolean;
}) {
  const [variantId, setVariantId] = useState("");
  const [language, setLanguage] = useState<Language>("zh");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (variantId.trim()) onDelete(variantId.trim(), language);
      }}
    >
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Variant ID</span>
        <Input placeholder="OP09-001_p1" value={variantId} onChange={(e) => setVariantId(e.target.value)} className="h-8 w-36" />
      </label>
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Language</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="block h-8 rounded-md border border-border bg-background px-2 text-sm"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {TCG_LANGUAGE_NAME[l]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" variant="destructive" disabled={pending || !variantId.trim()}>
        Delete Printing
      </Button>
    </form>
  );
}
