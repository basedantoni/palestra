import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Link to="/admin/exercises">
        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Exercise Review Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Review and approve or reject user-submitted custom exercises.
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
