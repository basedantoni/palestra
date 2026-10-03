import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  TRANSACTION_PERIOD_PRESETS,
  TRANSACTION_PERIOD_PRESET_LABELS,
  type TransactionPeriod,
  canStepForward,
  stepPeriod,
} from "@life-tracker/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { MonthGrid } from "./month-grid";
import { monthLabel } from "./month-label";

function periodLabel(period: TransactionPeriod): string {
  if (period.kind === "all") return "All time";
  if (period.kind === "preset") return TRANSACTION_PERIOD_PRESET_LABELS[period.preset];
  return monthLabel(period.month, "MMMM yyyy");
}

/**
 * Month stepper for the transaction feed (KOI-276): ‹ month ›, a popover with
 * shortcuts and a month grid, a Today button, and an All time toggle.
 * `today` is YYYY-MM-DD; future months can't be selected.
 */
export function TransactionPeriodPicker({
  period,
  today,
  onChange,
}: {
  period: TransactionPeriod;
  today: string;
  onChange: (next: TransactionPeriod) => void;
}) {
  const currentMonth = today.slice(0, 7);
  const [pickerOpen, setPickerOpen] = useState(false);

  const all = period.kind === "all";
  const onCurrentMonth = period.kind === "month" && period.month === currentMonth;
  const thisMonth: TransactionPeriod = { kind: "month", month: currentMonth };

  const choose = (next: TransactionPeriod) => {
    onChange(next);
    setPickerOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={all}
          onClick={() => onChange(stepPeriod(period, -1, today))}
          aria-label="Previous month"
        >
          <ChevronLeft />
        </Button>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button variant="ghost" disabled={all} className="min-w-40 text-lg font-semibold">
                {periodLabel(period)}
              </Button>
            }
          />
          <PopoverContent className="w-64 space-y-3 p-3" align="start">
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant={onCurrentMonth ? "default" : "outline"} onClick={() => choose(thisMonth)}>
                This month
              </Button>
              {TRANSACTION_PERIOD_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="xs"
                  variant={period.kind === "preset" && period.preset === preset ? "default" : "outline"}
                  onClick={() => choose({ kind: "preset", preset })}
                >
                  {TRANSACTION_PERIOD_PRESET_LABELS[preset]}
                </Button>
              ))}
            </div>
            <div className="border-t border-border pt-2">
              <MonthGrid
                selectedMonth={period.kind === "month" ? period.month : null}
                currentMonth={currentMonth}
                maxMonth={currentMonth}
                onSelect={(month) => choose({ kind: "month", month })}
              />
            </div>
          </PopoverContent>
        </Popover>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!canStepForward(period, today)}
          onClick={() => onChange(stepPeriod(period, 1, today))}
          aria-label="Next month"
        >
          <ChevronRight />
        </Button>
        {!all && !onCurrentMonth && (
          <Button size="xs" variant="outline" className="ml-1" onClick={() => onChange(thisMonth)}>
            Today
          </Button>
        )}
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => onChange(all ? thisMonth : { kind: "all" })}
      >
        {all ? "Back to months" : "All time"}
      </button>
    </div>
  );
}
