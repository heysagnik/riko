import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CaretUpDownIcon,
  QuestionIcon,
  SignOutIcon,
  ListIcon,
  XIcon,
  SidebarSimpleIcon,
  HouseIcon,
  ListChecksIcon,
  WarningIcon,
  PlugIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
} from "@phosphor-icons/react";
import { Logo } from "../../components/logo.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { Separator } from "../../components/ui/separator.js";
import { Switch } from "../../components/ui/switch.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { cn } from "../../lib/utils.js";
import { authClient } from "../../lib/auth-client.js";
import { useTheme } from "../../lib/theme.js";

const navItems = [
  { to: "/dashboard", label: "Overview", end: true, icon: HouseIcon },
  { to: "/dashboard/cases", label: "Cases", end: false, icon: ListChecksIcon },
  { to: "/dashboard/exceptions", label: "Exceptions", end: false, icon: WarningIcon },
  { to: "/dashboard/connections", label: "Connections", end: false, icon: PlugIcon },
  { to: "/dashboard/settings", label: "Settings", end: false, icon: GearIcon },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "riko:sidebar-collapsed";

function SiteHeader({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { pathname } = useLocation();
  const current = [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 md:px-8">
      <button
        type="button"
        onClick={onToggleSidebar}
        title="Toggle sidebar (Ctrl/⌘+B)"
        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-sunk hover:text-ink md:flex"
      >
        <SidebarSimpleIcon size={16} weight="regular" />
        <span className="sr-only">Toggle sidebar</span>
      </button>
      <Separator orientation="vertical" className="hidden h-4 md:block" />
      <p className="text-sm font-medium text-ink">{current?.label ?? "Dashboard"}</p>
    </header>
  );
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true",
  );

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/sign-in");
  };

  const userName = session?.user.name ?? activeOrganization?.name ?? "Account";
  const userEmail = session?.user.email ?? "";

  const sidebarContent = (
    <>
      <div className={cn("flex h-12 items-center px-3", collapsed ? "md:justify-center" : "justify-between")}>
        <Logo className={cn("md:block", collapsed && "md:hidden")} />
        {collapsed ? <Logo compact className="hidden md:block" /> : null}
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-sunk hover:text-ink md:hidden"
        >
          <XIcon size={20} weight="regular" />
          <span className="sr-only">Close navigation</span>
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-1 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-sm py-2.5 text-sm transition-colors duration-150 ease-out",
                  collapsed ? "md:justify-center md:px-0 px-3" : "pl-3 pr-3",
                  isActive ? "bg-accent/10 font-medium text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} weight={isActive ? "fill" : "regular"} className="shrink-0" />
                  <span className={collapsed ? "md:hidden" : undefined}>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-sunk hover:text-ink",
                collapsed && "md:justify-center",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-accent-soft text-caption font-medium text-ink">
                {(userName || userEmail).charAt(0).toUpperCase() || "?"}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", collapsed && "md:hidden")}>{userName}</span>
              <CaretUpDownIcon size={14} weight="regular" className={cn("shrink-0 text-ink-faint", collapsed && "md:hidden")} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuLabel>
              <p className="truncate text-sm font-medium text-ink">{userName}</p>
              {userEmail ? <p className="mt-0.5 truncate text-caption text-ink-faint">{userEmail}</p> : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <QuestionIcon size={16} weight="regular" className="shrink-0" />
              Help
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-sm text-ink-muted">
              <span>Appearance</span>
              <div className="flex items-center gap-1 rounded-md border border-line bg-surface-sunk p-0.5">
                <button
                  type="button"
                  aria-label="Light mode"
                  aria-pressed={resolvedTheme === "light"}
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    resolvedTheme === "light"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-faint hover:text-ink",
                  )}
                >
                  <SunIcon size={14} weight={resolvedTheme === "light" ? "fill" : "regular"} />
                </button>
                <button
                  type="button"
                  aria-label="Dark mode"
                  aria-pressed={resolvedTheme === "dark"}
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    resolvedTheme === "dark"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-faint hover:text-ink",
                  )}
                >
                  <MoonIcon size={14} weight={resolvedTheme === "dark" ? "fill" : "regular"} />
                </button>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <SignOutIcon size={16} weight="regular" className="shrink-0" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-surface md:h-screen md:min-h-0 md:overflow-hidden md:bg-surface-sunk">
      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-sunk hover:text-ink"
        >
          <ListIcon size={20} weight="regular" />
          <span className="sr-only">Open navigation</span>
        </button>
        <Logo />
      </header>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/40 duration-150 ease-out animate-in fade-in-0 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line bg-surface transition-[transform,width] duration-200 ease-out",
          "md:static md:z-auto md:translate-x-0 md:border-r-0 md:bg-transparent",
          collapsed ? "md:w-16" : "md:w-56",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>

      <main
        className={cn(
          "relative flex min-w-0 flex-1 flex-col pt-14 md:pt-0",
          "md:my-2 md:mr-2 md:min-h-0 md:overflow-hidden md:rounded-xl md:bg-surface md:shadow-sm",
        )}
      >
        <SiteHeader onToggleSidebar={toggleSidebar} />
        <div className="min-h-0 flex-1 md:overflow-y-auto">
          <div className="max-w-7xl px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <TooltipProvider delayDuration={200}>
              <Outlet />
            </TooltipProvider>
          </div>
        </div>
      </main>
    </div>
  );
}
