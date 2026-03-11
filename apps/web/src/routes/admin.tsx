import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }

    try {
      await context.queryClient.fetchQuery(
        context.trpc.admin.isAdmin.queryOptions(),
      );
    } catch {
      redirect({ to: "/dashboard", throw: true });
    }

    return { session };
  },
});

function AdminLayout() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <nav className="mt-2 flex gap-4 text-sm">
          <Link
            to="/admin/exercises"
            className="text-primary hover:underline"
          >
            Exercise Review Queue
          </Link>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
