// ────────────────────────────────────────────────────────────────────────
// Screen registry — the single source of truth for what counts as a
// "screen" for access-control purposes.
//
// Both Sidebar.tsx (nav rendering + filtering) and UserManagement.tsx
// (the checkbox list when creating/editing a portal user) import SCREENS
// from here, so there's exactly one place that maps a screen `key` to its
// route and label. Add a new screen here first, then wire its <Route> in
// App.tsx — don't hardcode screen keys anywhere else.
//
// `key` values are also what's stored (as a JSON array) in
// PortalUser.ALLOWED_SCREENS on the backend, so keep these stable — renaming
// a key here without a data migration will silently strip that screen from
// everyone who had it.
// ────────────────────────────────────────────────────────────────────────

export interface ScreenDef {
  key: string;
  label: string;
  path: string;
}

export const SCREENS: ScreenDef[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'attendance', label: 'Attendance', path: '/attendance' },
  { key: 'payroll', label: 'Payroll', path: '/payroll' },
  { key: 'filling', label: 'Filling', path: '/filling' },
  { key: 'wastage', label: 'Wastage', path: '/wastage' }
];

export function isValidScreenKey(key: string): boolean {
  return SCREENS.some((s) => s.key === key);
}
