import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";
import { NotificationBell } from "./notification-bell";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/workouts", label: "Workouts" },
    { to: "/templates", label: "Templates" },
    { to: "/settings", label: "Settings" },
    { to: "/analytics", label: "Analytics" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1 min-w-0">
        <nav className="flex gap-2 text-sm sm:gap-4 sm:text-lg overflow-x-auto">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
