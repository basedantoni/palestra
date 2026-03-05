import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/index";

export const Route = createFileRoute("/templates/")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions(),
    );

    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }

    return { session };
  },
});

function RouteComponent() {
  const { data: templates, isLoading } = useQuery(trpc.templates.list.queryOptions());

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Templates</h1>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading templates...</div>
      ) : templates && templates.length > 0 ? (
        <div className="space-y-3">
          {templates.map((template) => (
            <Link
              key={template.id}
              to="/templates/$templateId"
              params={{ templateId: template.id }}
            >
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{template.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {WORKOUT_TYPE_LABELS[template.workoutType]}
                      </Badge>
                      {template.isSystemTemplate ? (
                        <Badge variant="outline" className="text-xs">
                          System
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Personal
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No templates found.</div>
      )}
    </div>
  );
}
