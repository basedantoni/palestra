import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

// Layout for every /finance page: one auth gate. No component, so it renders the child's <Outlet />.
export const Route = createFileRoute("/finance")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});
