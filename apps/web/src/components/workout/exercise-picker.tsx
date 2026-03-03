import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { trpc } from "@/utils/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { EXERCISE_CATEGORY_LABELS } from "@src/api/lib/index";

interface ExercisePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (exercise: { id: string; name: string }) => void;
}

export function ExercisePicker({
  open,
  onOpenChange,
  onSelect,
}: ExercisePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(
    undefined,
  );

  const { data: exercises, isLoading } = useQuery(
    trpc.exercises.search.queryOptions({
      query: searchQuery || undefined,
      category: categoryFilter as any,
    }),
  );

  const handleSelectExercise = (exercise: { id: string; name: string }) => {
    onSelect(exercise);
    onOpenChange(false);
    setSearchQuery("");
    setCategoryFilter(undefined);
  };

  const categories = [
    "all",
    "chest",
    "back",
    "shoulders",
    "arms",
    "legs",
    "core",
    "cardio",
    "other",
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Exercise</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Category Tabs */}
          <Tabs
            value={categoryFilter || "all"}
            onValueChange={(value) =>
              setCategoryFilter(value === "all" ? undefined : value)
            }
          >
            <TabsList className="grid w-full grid-cols-5">
              {categories.slice(0, 5).map((cat) => (
                <TabsTrigger key={cat} value={cat}>
                  {cat === "all" ? "All" : EXERCISE_CATEGORY_LABELS[cat]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsList className="mt-2 grid w-full grid-cols-4">
              {categories.slice(5).map((cat) => (
                <TabsTrigger key={cat} value={cat}>
                  {EXERCISE_CATEGORY_LABELS[cat]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Exercise List */}
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading exercises...
              </div>
            ) : exercises && exercises.length > 0 ? (
              <div className="space-y-1">
                {exercises.map((exercise) => (
                  <button
                    key={exercise.id}
                    onClick={() => handleSelectExercise(exercise)}
                    className="flex w-full items-center justify-between border-b p-3 text-left transition-colors hover:bg-muted"
                  >
                    <div>
                      <div className="font-medium">{exercise.name}</div>
                      <div className="mt-1 flex gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {EXERCISE_CATEGORY_LABELS[exercise.category]}
                        </Badge>
                        {exercise.isCustom && (
                          <Badge variant="outline" className="text-xs">
                            Custom
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No exercises found
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
