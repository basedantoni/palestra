import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MATCH_MODES, MAX_PATTERN_LENGTH, type MatchMode, validatePattern } from "@life-tracker/api/lib/rules";
import { trpc, type RouterOutputs } from "@/utils/trpc";
import { useInvalidateFinance } from "@/hooks/use-invalidate-finance";
import { Button } from "@/components/ui/button";

import { CategoryPicker } from "./category-picker";

type RuleRow = RouterOutputs["rules"]["list"][number];
type CategoryRow = RouterOutputs["categories"]["list"][number];

/** Wait for typing to pause before asking the server for a match count. */
const PREVIEW_DEBOUNCE_MS = 300;

/** How each match mode reads in the list and the form's toggle. */
const MODE_LABELS: Record<MatchMode, string> = { contains: "Contains", exact: "Is exactly" };

/**
 * Rules tab on the budgets page (KOI-298/299, KOI-339): Rules categorize new
 * transactions at sync when their bank description is exactly, or contains,
 * the Pattern, and can be applied to past ones on save. Applying is one-shot:
 * deleting or editing a rule leaves already-categorized transactions as they are.
 */
export function RuleList() {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(trpc.rules.list.queryOptions());
  const { data: categories } = useQuery(trpc.categories.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.rules.pathKey() });
  const remove = useMutation(trpc.rules.delete.mutationOptions({ onSuccess: refresh }));

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
                  {MODE_LABELS[r.matchMode]} <span className="font-medium">“{r.pattern}”</span> → {r.categoryName}
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
        New transactions whose description is exactly, or contains, a pattern (ignoring case and accents) get its
        category. An exact match wins over any other; then the longest pattern wins, then the newest rule.
        Transactions you categorized by hand are never changed.
      </p>
    </div>
  );
}

/** A rule offered after a recategorize: its contains Pattern, and the whole description for exact. */
export interface RuleSuggestion {
  pattern: string;
  exactPattern: string;
  categoryId: string;
}

/**
 * Create a rule (optionally prefilled with `suggested`), or edit `editing`:
 * match mode, live Pattern validation, match count, and apply-to-existing.
 * Switching a suggestion's mode swaps in its Pattern for that mode. With `onDone`,
 * the form closes on save or Cancel; without it, it resets for the next rule.
 */
export function RuleForm({
  rules,
  categories,
  editing,
  suggested,
  onDone,
}: {
  rules: RuleRow[];
  categories: CategoryRow[];
  editing?: RuleRow;
  suggested?: RuleSuggestion;
  onDone?: () => void;
}) {
  const initial = editing ?? suggested;
  const queryClient = useQueryClient();
  const invalidateFinance = useInvalidateFinance();
  const [matchMode, setMatchMode] = useState<MatchMode>(editing?.matchMode ?? "contains");
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [touched, setTouched] = useState(false);
  const [debouncedPattern, setDebouncedPattern] = useState(pattern);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPattern(pattern), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pattern]);

  const validation = validatePattern(pattern, matchMode, rules, editing?.id);
  const debouncedValid = validatePattern(debouncedPattern, matchMode, rules, editing?.id);
  const preview = useQuery(
    trpc.rules.preview.queryOptions(
      {
        pattern: debouncedValid.ok ? debouncedValid.pattern : "",
        matchMode,
        categoryId,
        ruleId: editing?.id,
      },
      { enabled: debouncedValid.ok && !!categoryId },
    ),
  );

  const onSuccess = ({ applied }: { applied: number }) => {
    queryClient.invalidateQueries({ queryKey: trpc.rules.pathKey() });
    // Applying recategorizes transactions, which ripples into budget and finance spend.
    if (applied > 0) invalidateFinance();
    if (onDone) return onDone();
    setPattern("");
    setTouched(false);
  };
  const create = useMutation(trpc.rules.create.mutationOptions({ onSuccess }));
  const update = useMutation(trpc.rules.update.mutationOptions({ onSuccess }));
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
        const input = { pattern: validation.pattern, matchMode, categoryId, applyToExisting };
        if (editing) update.mutate({ id: editing.id, ...input });
        else create.mutate(input);
      }}
    >
      {/* Wraps in narrow spots (the offer dialog) instead of overflowing. */}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Match"
          value={matchMode}
          onChange={(e) => {
            const mode = e.target.value as MatchMode;
            setMatchMode(mode);
            if (suggested) setPattern(mode === "exact" ? suggested.exactPattern : suggested.pattern);
            save.reset();
          }}
          className="rounded-md border border-border bg-background px-1.5 py-1 text-sm"
        >
          {MATCH_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <input
          autoFocus={!!initial}
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            save.reset();
          }}
          onBlur={() => pattern && setTouched(true)}
          placeholder={matchMode === "exact" ? "Whole description" : "Part of the description"}
          maxLength={MAX_PATTERN_LENGTH}
          aria-label="Pattern"
          aria-invalid={!!patternError}
          aria-describedby={errorId}
          className="min-w-40 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <CategoryPicker aria-label="Category" categories={categories} value={categoryId} onChange={setCategoryId} />
        <div className="ml-auto flex gap-2">
          <Button size="sm" type="submit" disabled={!pattern.trim() || !categoryId || save.isPending}>
            {editing ? "Save" : "Add"}
          </Button>
          {onDone && (
            <Button size="sm" type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      {patternError && (
        <p id={errorId} className="text-xs text-destructive">
          {patternError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span aria-live="polite">
          {matchCount === undefined
            ? "\u00a0"
            : `Will update ${matchCount} existing ${matchCount === 1 ? "transaction" : "transactions"}`}
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
          Apply to existing transactions
        </label>
      </div>
    </form>
  );
}
