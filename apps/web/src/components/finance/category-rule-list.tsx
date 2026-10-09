import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MAX_PATTERN_LENGTH, validatePattern } from "@life-tracker/api/lib/category-rules";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { Button } from "@/components/ui/button";

type RuleRow = RouterOutputs["categoryRules"]["list"][number];
type CategoryRow = RouterOutputs["categories"]["list"][number];

/** Wait for typing to pause before asking the server for a match count. */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Rules tab on the budgets page (KOI-298/299): Category Rules categorize new
 * transactions at sync when their bank description contains the Pattern, and
 * can be applied to past ones on save. Applying is one-shot: deleting or
 * editing a rule leaves already-categorized transactions as they are.
 */
export function CategoryRuleList() {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(trpc.categoryRules.list.queryOptions());
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.categoryRules.pathKey() });
  const remove = useMutation(trpc.categoryRules.delete.mutationOptions({ onSuccess: refresh }));

  if (!rules || !categories) return <div className="text-muted-foreground">Loading rules…</div>;

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {rules.map((r) =>
            editingId === r.id ? (
              <li key={r.id} className="px-3 py-2">
                <RuleForm rules={rules} categories={categories} editing={r} onDone={() => setEditingId(null)} />
              </li>
            ) : (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  Contains <span className="font-medium">“{r.pattern}”</span> → {r.categoryName}
                </span>
                <span className="flex items-center gap-1">
                  <Button size="icon-xs" variant="ghost" onClick={() => setEditingId(r.id)} aria-label={`Edit rule ${r.pattern}`}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: r.id })}
                    aria-label={`Delete rule ${r.pattern}`}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {remove.error && <p className="text-xs text-destructive">{remove.error.message}</p>}

      {editingId === null && <RuleForm rules={rules} categories={categories} />}
      <p className="text-xs text-muted-foreground">
        New transactions whose description contains a pattern (ignoring case) get its category. When several match,
        the longest pattern wins, then the newest rule. Transactions you categorized by hand are never changed.
      </p>
    </div>
  );
}

/** Create a rule, or edit `editing`: live Pattern validation, match count, and apply-to-existing. */
function RuleForm({
  rules,
  categories,
  editing,
  onDone,
}: {
  rules: RuleRow[];
  categories: CategoryRow[];
  editing?: RuleRow;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const invalidateFinance = useInvalidateFinance();
  const [pattern, setPattern] = useState(editing?.pattern ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [touched, setTouched] = useState(false);
  const [debouncedPattern, setDebouncedPattern] = useState(pattern);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPattern(pattern), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pattern]);

  const validation = validatePattern(pattern, rules, editing?.id);
  const debouncedValid = validatePattern(debouncedPattern, rules, editing?.id);
  const preview = useQuery(
    trpc.categoryRules.preview.queryOptions(
      {
        pattern: debouncedValid.ok ? debouncedValid.pattern : "",
        categoryId,
        ruleId: editing?.id,
      },
      { enabled: debouncedValid.ok && !!categoryId },
    ),
  );

  const onSuccess = ({ applied }: { applied: number }) => {
    queryClient.invalidateQueries({ queryKey: trpc.categoryRules.pathKey() });
    // Applying recategorizes transactions, which ripples into budget and finance spend.
    if (applied > 0) invalidateFinance();
    if (editing) return onDone?.();
    setPattern("");
    setTouched(false);
  };
  const create = useMutation(trpc.categoryRules.create.mutationOptions({ onSuccess }));
  const update = useMutation(trpc.categoryRules.update.mutationOptions({ onSuccess }));
  const save = editing ? update : create;

  const patternError = touched && !validation.ok ? validation.reason : save.error?.message;
  const errorId = `rule-pattern-error-${editing?.id ?? "new"}`;
  const matchCount = validation.ok && categoryId && pattern === debouncedPattern ? preview.data?.matchCount : undefined;

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!validation.ok || !categoryId) return;
        const input = { pattern: validation.pattern, categoryId, applyToExisting };
        if (editing) update.mutate({ id: editing.id, ...input });
        else create.mutate(input);
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus={!!editing}
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            save.reset();
          }}
          onBlur={() => pattern && setTouched(true)}
          placeholder="Description contains…"
          maxLength={MAX_PATTERN_LENGTH}
          aria-label="Pattern"
          aria-invalid={!!patternError}
          aria-describedby={errorId}
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
        <Button size="sm" type="submit" disabled={!pattern.trim() || !categoryId || save.isPending}>
          {editing ? "Save" : "Add"}
        </Button>
        {editing && (
          <Button size="sm" type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
            Cancel
          </Button>
        )}
      </div>
      {patternError && (
        <p id={errorId} className="text-xs text-destructive">
          {patternError}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {matchCount === undefined
            ? "\u00a0"
            : `Matches ${matchCount} existing ${matchCount === 1 ? "transaction" : "transactions"}`}
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
          Apply to existing transactions
        </label>
      </div>
    </form>
  );
}
