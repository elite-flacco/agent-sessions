"use client";

import {
  BarChart3,
  Blocks,
  CircleDot,
  Database,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface SidebarProps {
  connectedAgents: number;
  sourceErrors: number;
}

export function Sidebar({ connectedAgents, sourceErrors }: SidebarProps) {
  const pathname = usePathname();
  return (
    <aside className="relay-sidebar">
      <div className="brand-block">
        <div className="brand-mark">R</div>
        <div className="brand-copy">
          <strong>Relay</strong>
          <span>Agent operations</span>
        </div>
      </div>
      <nav aria-label="Primary navigation" className="primary-nav">
        <NavLink
          href="/"
          active={pathname === "/"}
          icon={<LayoutDashboard size={15} />}
          label="Overview"
        />
        <NavLink
          href="/sessions"
          active={pathname.startsWith("/sessions") || pathname === "/projects"}
          icon={<Database size={15} />}
          label="Sessions"
        />
        <NavLink
          href="/usage"
          active={pathname === "/usage"}
          icon={<BarChart3 size={15} />}
          label="Usage & cost"
        />
        <NavLink
          href="/agents"
          active={pathname === "/agents"}
          icon={<Blocks size={15} />}
          label="Agent setup"
        />
      </nav>
      <div className="sidebar-footer">
        <div className="connection-card">
          <CircleDot size={14} />
          <div>
            <strong>{connectedAgents} agents connected</strong>
            <span>
              {sourceErrors
                ? `${sourceErrors} sources need attention`
                : "Local data only"}
            </span>
          </div>
        </div>
        <div className="profile-row">
          <div className="avatar">SS</div>
          <div>
            <strong>Shuang</strong>
            <span>Personal workspace</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={active ? "nav-row nav-active" : "nav-row"}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
