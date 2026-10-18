import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CategoryPicker } from "@/components/finance/category-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFinanceToday } from "@/hooks/use-finance-today";
import { trpc, type RouterOutputs } from "@/utils/trpc";

type Settings = NonNullable<RouterOutputs["tcg"]["fund"]["get"]["settings"]>;

const field = "block w-full rounded-md border border-border bg-background px-2 py-1 text-sm";
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** The caller's Card Fund (null until a Cards category is set). */
export function useCardFund() {
  return useQuery(trpc.tcg.fund.get.queryOptions()).data?.fund ?? null;
}

/** Card Fund balance, this month's Cards budget and spend, months with no budget, and settings (ADR 0005). */
export function CardFundPanel() {
  const { data, isLoading } = useQuery(trpc.tcg.fund.get.queryOptions());
  const [editing, setEditing] = useState(false);
  if (isLoading || !data) return null;
  const { settings, fund } = data;

  return (
    <section className="space-y-2 border border-border p-3 text-sm" aria-label="Card Fund">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Card Fund</h2>
        <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
          Settings
        </Button>
      </div>
      {!fund ? (
        <p className="text-muted-foreground">Choose which finance category counts as Cards to see your fund.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-bold tabular-nums">{usd(fund.balance)}</span>
            <span className="text-muted-foreground">
              {monthLabel(fund.currentMonth)}: {usd(fund.thisMonth.spent)} spent of{" "}
              {fund.thisMonth.limit === null ? "no budget" : usd(fund.thisMonth.limit)}
            </span>
            <span className="text-xs text-muted-foreground">since {monthLabel(settings!.startMonth)}</span>
          </div>
          {fund.missingMonths.length > 0 && (
            <p role="alert" className="text-xs text-destructive">
              No Cards budget for {fund.missingMonths.map(monthLabel).join(", ")}. These months add nothing to the
              fund.
            </p>
          )}
        </>
      )}
      {editing && <FundSettingsDialog settings={settings} onClose={() => setEditing(false)} />}
    </section>
  );
}

function FundSettingsDialog({ settings, onClose }: { settings: Settings | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = useFinanceToday();
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [categoryId, setCategoryId] = useState(settings?.cardsCategoryId ?? "");
  const [startMonth, setStartMonth] = useState(settings?.startMonth ?? today.slice(0, 7));
  const save = useMutation(
    trpc.tcg.fund.saveSettings.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.tcg.fund.get.queryKey() });
        onClose();
      },
    }),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Card Fund settings</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ cardsCategoryId: categoryId, startMonth });
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Cards category</span>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Choose a category"
              className="w-full"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Start month</span>
            <input
              type="month"
              required
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className={field}
            />
          </label>
          {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!categoryId || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
