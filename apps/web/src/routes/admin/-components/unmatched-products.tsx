import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/utils/trpc";

type Product = RouterOutputs["admin"]["market"]["unmatchedProducts"][number];

const MARKETPLACE_LABEL: Record<Product["marketplace"], string> = { tcgplayer: "TCGplayer", cardtrader: "CardTrader" };

/**
 * The Marketplace Products the matcher couldn't place (KOI-368). Each takes a manual match by
 * variant ID, or "not an Artwork" (`variantId: null`).
 */
export function UnmatchedProducts({
  products,
  onMatch,
  pending = false,
}: {
  products: Product[];
  onMatch: (id: number, variantId: string | null) => void;
  pending?: boolean;
}) {
  if (products.length === 0) {
    return <div className="rounded border p-8 text-center text-sm text-muted-foreground">Every Marketplace Product is matched.</div>;
  }
  return (
    <div className="overflow-x-auto border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {["Marketplace", "External id", "Name", "Number", "Set", "Reason", "Match"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {products.map((p) => (
            <Row key={p.id} product={p} onMatch={onMatch} pending={pending} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ product: p, onMatch, pending }: { product: Product; onMatch: (id: number, variantId: string | null) => void; pending: boolean }) {
  const [variantId, setVariantId] = useState("");
  return (
    <tr aria-label={p.name}>
      <td className="px-3 py-2">{MARKETPLACE_LABEL[p.marketplace]}</td>
      <td className="px-3 py-2 font-mono text-xs">{p.externalId}</td>
      <td className="px-3 py-2">{p.name}</td>
      <td className="px-3 py-2 font-mono text-xs">{p.number}</td>
      <td className="px-3 py-2">{p.set}</td>
      <td className="px-3 py-2 text-muted-foreground">{p.reason}</td>
      <td className="px-3 py-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (variantId.trim()) onMatch(p.id, variantId.trim());
          }}
        >
          <Input
            aria-label={`Variant ID for ${p.externalId}`}
            placeholder="OP05-119_p1"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="h-8 w-36"
          />
          <Button type="submit" size="sm" disabled={pending || !variantId.trim()}>
            Match
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onMatch(p.id, null)}>
            Not an Artwork
          </Button>
        </form>
      </td>
    </tr>
  );
}
