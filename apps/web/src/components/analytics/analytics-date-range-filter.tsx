import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { NormalizedAnalyticsRangeSearch } from "@life-tracker/shared";
import {
  ANALYTICS_RANGE_LABELS,
  formatLocalDate,
  parseLocalDate,
  resolveAnalyticsRangeBounds,
} from "@life-tracker/shared";

type AnalyticsDateRangeFilterProps = {
  search: NormalizedAnalyticsRangeSearch;
  onChange: (next: NormalizedAnalyticsRangeSearch) => void;
};

function formatActiveRangeLabel(search: NormalizedAnalyticsRangeSearch): string {
  const resolved = resolveAnalyticsRangeBounds(search);

  if (resolved.range === "all") {
    return "All time";
  }

  if (resolved.range === "custom" && resolved.from && resolved.to) {
    return `${format(parseLocalDate(resolved.from), "MMM d, yyyy")} - ${format(parseLocalDate(resolved.to), "MMM d, yyyy")}`;
  }

  if (resolved.range === "30d") {
    return "Last 30 days";
  }

  if (resolved.range === "3m") {
    return "Last 3 months";
  }

  if (resolved.range === "6m") {
    return "Last 6 months";
  }

  return "Last year";
}

export function AnalyticsDateRangeFilter({
  search,
  onChange,
}: AnalyticsDateRangeFilterProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const activeRangeLabel = useMemo(() => formatActiveRangeLabel(search), [search]);

  const selectedCustomRange = useMemo<DateRange | undefined>(() => {
    if (search.range !== "custom" || !search.from || !search.to) {
      return undefined;
    }

    return {
      from: parseLocalDate(search.from),
      to: parseLocalDate(search.to),
    };
  }, [search]);

  const [draftRange, setDraftRange] = useState<DateRange | undefined>(
    selectedCustomRange,
  );

  useEffect(() => {
    setDraftRange(selectedCustomRange);
  }, [selectedCustomRange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["30d", "3m", "6m", "1y", "all"] as const).map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={search.range === preset ? "default" : "outline"}
            onClick={() => onChange({ range: preset })}
          >
            {ANALYTICS_RANGE_LABELS[preset]}
          </Button>
        ))}

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger
            render={
              <Button
                size="sm"
                variant={search.range === "custom" ? "default" : "outline"}
              >
                {ANALYTICS_RANGE_LABELS.custom}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-3 pb-0">
              <PopoverHeader>
                <PopoverTitle>Custom range</PopoverTitle>
                <PopoverDescription>
                  Pick an inclusive from-to range. The chart will refetch when both dates are selected.
                </PopoverDescription>
              </PopoverHeader>
            </div>
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={(next) => {
                setDraftRange(next);

                if (next?.from && next.to) {
                  onChange({
                    range: "custom",
                    from: formatLocalDate(next.from),
                    to: formatLocalDate(next.to),
                  });
                  setCustomOpen(false);
                }
              }}
              disabled={(date) => date > new Date()}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-sm text-muted-foreground">{activeRangeLabel}</p>
    </div>
  );
}
