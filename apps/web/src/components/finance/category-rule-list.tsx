import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MAX_PATTERN_LENGTH, validatePattern } from "@life-tracker/api/lib/category-rules";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

/**
 * Rules tab on the budgets page (KOI-298): Category Rules categorize new
 * transactions at sync when their bank description contains the Pattern.
 * Deleting a rule leaves already-categorized transactions as they are.
 */
export function CategoryRuleList() {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(trpc.categoryRules.list.queryOptions());
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [touched, setTouched] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.categoryRules.pathKey() });
  const create = useMutation(
    trpc.categoryRules.create.mutationOptions({
      onSuccess: () => {
        setPattern("");
        setTouched(false);
        refresh();
      },
    }),
  );
  const remove = useMutation(trpc.categoryRules.delete.mutationOptions({ onSuccess: refresh }));

  if (!rules || !categories) return <div className="text-muted-foreground">Loading rules…</div>;

  const validation = validatePattern(pattern, rules);
  const patternError = touched && !validation.ok ? validation.reason : create.error?.message;

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                Contains <span className="font-medium">“{r.pattern}”</span> → {r.categoryName}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: r.id })}
                aria-label={`Delete rule ${r.pattern}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {remove.error && <p className="text-xs text-destructive">{remove.error.message}</p>}

      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (validation.ok && categoryId) create.mutate({ pattern: validation.pattern, categoryId });
        }}
      >
        <div className="flex gap-2">
          <input
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value);
              create.reset();
            }}
            onBlur={() => pattern && setTouched(true)}
            placeholder="Description contains…"
            maxLength={MAX_PATTERN_LENGTH}
            aria-label="Pattern"
            aria-invalid={!!patternError}
            aria-describedby="rule-pattern-error"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="Category"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="" disabled>
              Category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" type="submit" disabled={!pattern.trim() || !categoryId || create.isPending}>
            Add
          </Button>
        </div>
        {patternError && (
          <p id="rule-pattern-error" className="text-xs text-destructive">
            {patternError}
          </p>
        )}
      </form>
      <p className="text-xs text-muted-foreground">
        New transactions whose description contains a pattern (ignoring case) get its category. When several match,
        the longest pattern wins, then the newest rule.
      </p>
    </div>
  );
}
