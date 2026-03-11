import { startTransition, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXERCISE_CATEGORY_LABELS } from "@src/api/lib/index";

type ExerciseResult = {
  id: string;
  name: string;
  category: string;
};

interface CreateCustomExerciseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (exercise: { id: string; name: string }) => void;
}

const CATEGORIES = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "legs",
  "core",
  "cardio",
  "other",
] as const;

const EXERCISE_TYPES = [
  "weightlifting",
  "hiit",
  "cardio",
  "calisthenics",
  "yoga",
  "sports",
  "mixed",
] as const;

const EXERCISE_TYPE_LABELS: Record<(typeof EXERCISE_TYPES)[number], string> = {
  weightlifting: "Weightlifting",
  hiit: "HIIT",
  cardio: "Cardio",
  calisthenics: "Calisthenics",
  yoga: "Yoga",
  sports: "Sports",
  mixed: "Mixed",
};

export function CreateCustomExerciseModal({
  open,
  onOpenChange,
  onCreated,
}: CreateCustomExerciseModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]>("other");
  const [exerciseType, setExerciseType] =
    useState<(typeof EXERCISE_TYPES)[number]>("weightlifting");
  const [linkedExerciseQuery, setLinkedExerciseQuery] = useState("");
  const [linkedExerciseSearch, setLinkedExerciseSearch] = useState("");
  const [linkedExercise, setLinkedExercise] =
    useState<ExerciseResult | null>(null);
  const [showLinkedSearch, setShowLinkedSearch] = useState(false);

  const { data: linkedSearchResults } = useQuery(
    trpc.exercises.search.queryOptions(
      linkedExerciseSearch ? { query: linkedExerciseSearch } : undefined,
      { enabled: linkedExerciseSearch.length > 0 },
    ),
  );

  const createMutation = useMutation(
    trpc.exercises.createCustom.mutationOptions({
      onSuccess: (created) => {
        toast.success(`"${created.name}" submitted for review`);
        onCreated?.(created);
        handleClose();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to create exercise");
      },
    }),
  );

  const handleClose = () => {
    setName("");
    setCategory("other");
    setExerciseType("weightlifting");
    setLinkedExerciseQuery("");
    setLinkedExerciseSearch("");
    setLinkedExercise(null);
    setShowLinkedSearch(false);
    onOpenChange(false);
  };

  const handleLinkedSearchChange = (value: string) => {
    setLinkedExerciseQuery(value);
    startTransition(() => {
      setLinkedExerciseSearch(value);
    });
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Exercise name is required");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      category,
      exerciseType,
      linkedExerciseId: linkedExercise?.id,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Custom Exercise</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="exercise-name">Name</Label>
            <Input
              id="exercise-name"
              placeholder="e.g. Zercher Squat"
              value={name}
              onChange={(e) =>
                setName(e.target.value)
              }
            />
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(val) =>
                setCategory(val as (typeof CATEGORIES)[number])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {EXERCISE_CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Exercise Type */}
          <div className="space-y-1">
            <Label>Exercise Type</Label>
            <Select
              value={exerciseType}
              onValueChange={(val) =>
                setExerciseType(val as (typeof EXERCISE_TYPES)[number])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {EXERCISE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {EXERCISE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Linked Exercise (optional) */}
          <div className="space-y-1">
            <Label>Linked Exercise (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Link to a similar public exercise as a movement-pattern reference.
            </p>
            {linkedExercise ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {linkedExercise.name}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    setLinkedExercise(null);
                    setLinkedExerciseQuery("");
                    setLinkedExerciseSearch("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search exercises..."
                  value={linkedExerciseQuery}
                  onFocus={() => setShowLinkedSearch(true)}
                  onBlur={() =>
                    setTimeout(() => setShowLinkedSearch(false), 150)
                  }
                  onChange={(e) => handleLinkedSearchChange(e.target.value)}
                />
                {showLinkedSearch &&
                  linkedSearchResults &&
                  linkedSearchResults.length > 0 ? (
                  <div className="absolute z-50 mt-1 w-full border bg-background shadow-md">
                    <ScrollArea className="max-h-48">
                      {linkedSearchResults.map((ex) => (
                        <button
                          key={ex.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={() => {
                            setLinkedExercise(ex);
                            setLinkedExerciseQuery("");
                            setLinkedExerciseSearch("");
                            setShowLinkedSearch(false);
                          }}
                        >
                          <span>{ex.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {EXERCISE_CATEGORY_LABELS[ex.category as keyof typeof EXERCISE_CATEGORY_LABELS]}
                          </Badge>
                        </button>
                      ))}
                    </ScrollArea>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? "Submitting..." : "Submit for Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
