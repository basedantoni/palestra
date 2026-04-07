import { Badge } from "@/components/ui/badge";

type CustomExerciseStatus = "pending" | "approved" | "rejected" | "imported" | null;

interface CustomExerciseStatusBadgeProps {
  status: CustomExerciseStatus;
}

export function CustomExerciseStatusBadge({
  status,
}: CustomExerciseStatusBadgeProps) {
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-yellow-500 text-yellow-600 dark:text-yellow-400"
      >
        Pending Review
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-green-500 text-green-600 dark:text-green-400"
      >
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-red-500 text-red-600 dark:text-red-400"
      >
        Not Approved
      </Badge>
    );
  }
  if (status === "imported") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-blue-500 text-blue-600 dark:text-blue-400"
      >
        Pending Review
      </Badge>
    );
  }
  return null;
}
