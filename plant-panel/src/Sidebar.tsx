import { NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard,
  Wallet,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
  Activity,
} from 'lucide-react';

// ─── Nav structure ───────────────────────────────────────────────────────────
// Add new pages here — `path` must match the route in your router config.

interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  badge?: number; // optional notification dot/count
}

const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: 'Operations',
    items: [
      { key: 'attendance', label: 'Attendance', path: '/attendance', icon: LayoutDashboard },
      { key: 'payroll',    label: 'Payroll',    path: '/payroll',    icon: Wallet },
    ],
  },
  {
    group: 'People',
    items: [
      { key: 'employees',    label: 'Employees',    path: '/employees',    icon: Users },
      { key: 'departments',  label: 'Departments',  path: '/departments',  icon: Building2 },
    ],
  },
  {
    group: 'System',
    items: [
      { key: 'activity', label: 'Activity',  path: '/activity', icon: Activity },
      { key: 'settings', label: 'Settings',  path: '/settings', icon: Settings },
    ],
  },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  /** Plant / company name shown in the wordmark */
  plantName?: string;
  /** Employee count shown in sub-label */
  employeeCount?: number;
  /** Avatar initials / name for the logged-in supervisor */
  supervisorName?: string;
  /** Avatar label (e.g. "Line Supervisor") */
  supervisorRole?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Sidebar({
  plantName = 'Plant Ops',
  employeeCount,
  supervisorName = 'Supervisor',
  supervisorRole = 'Line Supervisor',
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside
        className={`
          hidden sm:flex flex-col
          sticky top-0 h-screen shrink-0
          border-r border-zinc-200 bg-white
          transition-[width] duration-200 ease-in-out
          ${collapsed ? 'w-[60px]' : 'w-[220px]'}
        `}
      >
        {/* Wordmark */}
        <div className={`flex items-center gap-2.5 px-4 py-5 ${collapsed ? 'justify-center px-0' : ''}`}>
          {/* Logo mark — a simple factory icon built inline */}
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1" y="7" width="3" height="6" fill="white" opacity="0.9" rx="0.5" />
              <rect x="5.5" y="4" width="3" height="9" fill="white" rx="0.5" />
              <rect x="10" y="1" width="3" height="12" fill="white" opacity="0.7" rx="0.5" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold tracking-tight text-zinc-900">
                {plantName}
              </div>
              {employeeCount !== undefined && (
                <div className="font-mono text-[10px] text-zinc-400">
                  {employeeCount} employees
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2">
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group}>
              {!collapsed && (
                <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
                  {group}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map(({ key, label, path, icon: Icon, badge }) => (
                  <NavLink
                    key={key}
                    to={path}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors
                      ${collapsed ? 'justify-center px-0 py-2.5' : ''}
                      ${
                        isActive
                          ? 'bg-zinc-900 text-white'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                      }`
                    }
                    title={collapsed ? label : undefined}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={15}
                          className={isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-600'}
                        />
                        {!collapsed && <span className="truncate">{label}</span>}
                        {badge != null && badge > 0 && (
                          <span
                            className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold
                              ${isActive ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-500'}`}
                          >
                            {badge}
                          </span>
                        )}
                        {/* Tooltip when collapsed */}
                        {collapsed && (
                          <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-800 shadow-md group-hover:flex">
                            {label}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className={`border-t border-zinc-100 px-2 py-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && <span className="font-mono text-[11px]">Collapse</span>}
          </button>
        </div>

        {/* Supervisor chip */}
        <div className={`border-t border-zinc-100 p-3 ${collapsed ? 'flex justify-center' : ''}`}>
          <div
            className={`flex items-center gap-2.5 rounded-lg px-2 py-2 ${collapsed ? '' : ''}`}
            title={collapsed ? `${supervisorName} · ${supervisorRole}` : undefined}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
              {initials(supervisorName)}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-zinc-800">{supervisorName}</div>
                <div className="truncate font-mono text-[10px] text-zinc-400">{supervisorRole}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-200 bg-white sm:hidden">
        {/* Show only first 4 items flat on mobile */}
        {NAV_GROUPS.flatMap((g) => g.items)
          .slice(0, 4)
          .map(({ key, label, path, icon: Icon }) => (
            <NavLink
              key={key}
              to={path}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium transition-colors
                ${isActive ? 'text-zinc-900' : 'text-zinc-400'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={isActive ? 'text-zinc-900' : 'text-zinc-400'} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
      </nav>
    </>
  );
}