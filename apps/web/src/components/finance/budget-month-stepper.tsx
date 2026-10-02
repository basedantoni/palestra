import { useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { addMonths } from "@life-tracker/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { MonthGrid } from "./month-grid";

/**
 * ‹ Month › stepper for budgets (KOI-284). Unlike the transactions picker,
 * future months are allowed so limits can be planned ahead.
 */
export function BudgetMonthStepper({
  month,
  currentMonth,
  onChange,
}: {
  month: string;
  currentMonth: string;
  onChange: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (
    <div className="flex items-center gap-1">
      <Button size="icon-sm" variant="ghost" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month">
        <ChevronLeft />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="ghost" className="min-w-40 text-lg font-semibold">
              {format(new Date(y, m - 1, 1), "MMMM yyyy")}
            </Button>
          }
        />
        <PopoverContent className="w-64 p-3" align="start">
          <MonthGrid
            selectedMonth={month}
            currentMonth={currentMonth}
            onSelect={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button size="icon-sm" variant="ghost" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month">
        <ChevronRight />
      </Button>
      {month !== currentMonth && (
        <Button size="xs" variant="outline" className="ml-1" onClick={() => onChange(currentMonth)}>
          Today
        </Button>
      )}
    </div>
  );
}
