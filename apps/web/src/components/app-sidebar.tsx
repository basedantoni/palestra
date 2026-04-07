import { Link } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { NotificationBell } from "./notification-bell";

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();

  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/workouts", label: "Workouts" },
    { to: "/templates", label: "Templates" },
    { to: "/analytics", label: "Analytics" },
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
            {links.map(({ to, label }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  render={
                    <Link to={to} onClick={() => setOpenMobile(false)}>
                      {label}
                    </Link>
                  }
                />
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
