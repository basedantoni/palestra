import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Year header + 3×4 month grid used inside the finance month pickers.
 * The selected month is filled and the current month outlined; months after
 * `maxMonth` (YYYY-MM) are disabled when it's given.
 */
export function MonthGrid({
  selectedMonth,
  currentMonth,
  maxMonth,
  onSelect,
}: {
  selectedMonth: string | null;
  currentMonth: string;
  maxMonth?: string;
  onSelect: (month: string) => void;
}) {
  const [year, setYear] = useState(Number((selectedMonth ?? currentMonth).slice(0, 4)));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Button size="icon-xs" variant="ghost" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
          <ChevronLeft />
        </Button>
        <span className="text-sm font-semibold">{year}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={maxMonth !== undefined && year >= Number(maxMonth.slice(0, 4))}
          onClick={() => setYear((y) => y + 1)}
          aria-label="Next year"
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS_SHORT.map((label, i) => {
          const month = `${year}-${pad(i + 1)}`;
          return (
            <Button
              key={label}
              size="sm"
              variant={month === selectedMonth ? "default" : month === currentMonth ? "outline" : "ghost"}
              disabled={maxMonth !== undefined && month > maxMonth}
              onClick={() => onSelect(month)}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
