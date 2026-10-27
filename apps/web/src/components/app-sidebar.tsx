import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { NotificationBell } from "./notification-bell";

const FINANCE_PAGES = [
  { to: "/finance/spending", label: "Spending" },
  { to: "/finance/transactions", label: "Transactions" },
  { to: "/finance/budgets", label: "Budgets" },
  { to: "/finance/accounts", label: "Accounts" },
  { to: "/finance/goals", label: "Goals" },
] as const;

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Follows the route (open inside /finance) until the chevron is toggled.
  const [financeToggled, setFinanceToggled] = useState<boolean | null>(null);
  const financeOpen = financeToggled ?? pathname.startsWith("/finance");

  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/workouts", label: "Workouts" },
    { to: "/templates", label: "Templates" },
    { to: "/analytics", label: "Analytics" },
    { to: "/finance", label: "Finance", children: FINANCE_PAGES },
    { to: "/tcg", label: "Cards" },
    { to: "/import", label: "Import" },
    { to: "/settings", label: "Settings" },
  ] as const;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="self-end">
            <SidebarMenuButton render={<NotificationBell />} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {links.map((link) => (
              <SidebarMenuItem key={link.to}>
                <SidebarMenuButton
                  render={
                    <Link to={link.to} onClick={() => setOpenMobile(false)}>
                      {link.label}
                    </Link>
                  }
                />
                {"children" in link && (
                  <SidebarMenuAction
                    aria-label={`${financeOpen ? "Collapse" : "Expand"} ${link.label}`}
                    aria-expanded={financeOpen}
                    onClick={() => setFinanceToggled(!financeOpen)}
                  >
                    <ChevronRight className={financeOpen ? "rotate-90 transition-transform" : "transition-transform"} />
                  </SidebarMenuAction>
                )}
                {"children" in link && financeOpen && (
                  <SidebarMenuSub>
                    {link.children.map(({ to, label }) => (
                      <SidebarMenuSubItem key={to}>
                        <SidebarMenuSubButton
                          className="data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium"
                          render={
                            <Link to={to} onClick={() => setOpenMobile(false)}>
                              {label}
                            </Link>
                          }
                        />
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="flex flex-row justify-between">
          <SidebarMenuItem>
            <SidebarMenuButton render={<UserMenu />} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<ModeToggle />} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
